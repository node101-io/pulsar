import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { Master } from "../master.js";
import { connection } from "../redis.js";
import { bridgeTxSenderQ } from "../queue.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";
import {
    BridgeStateModel,
    getBridgeState,
} from "../../db/models/BridgeState.js";
import {
    type MinaClientContext,
    initMinaClientContext,
    refreshContractState,
    getContractActionState,
    getActionStateHistory,
} from "../../services/mina/client.js";
import {
    MASTER_SLEEP_INTERVAL_MS,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MAX_FAIL_COUNT,
    TRANSIENT_EXIT_CODE,
} from "../../config/constants.js";

export interface BridgeTxJob {
    /**
     * Queue front (contract actionState) observed when the job was queued —
     * traceability only; the worker re-derives everything from the chain.
     */
    fromActionState: string;
}

// Bump txFailCount and clear the in-flight flag in one atomic pipeline
// update. Shared by the job-failed listener and the boot-time recovery of
// interrupted attempts, so a crash-looping front converges to the halt.
const FAILURE_BOOKKEEPING_PIPELINE = [
    {
        $set: {
            txFailCount: { $add: [{ $ifNull: ["$txFailCount", 0] }, 1] },
            txAttemptActive: false,
        },
    },
];

/**
 * Run one reduce job in a child process (job-main.ts) and translate its exit
 * into the failure vocabulary onJobFailed expects.
 *
 * A child, not an in-process call: o1js proving can freeze the event loop
 * from native code, and a frozen loop runs no timers — the only supervision
 * that survives it lives in another process. SIGKILL after WORKER_TIMEOUT_MS
 * (~2x the slowest observed job) recovers the pipeline; the kill is booked
 * as a real strike, because a prover that freezes deterministically on one
 * batch must eventually trip the circuit breaker, not retry forever.
 */
function runReduceJobInChild(fromActionState: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const entry = fileURLToPath(new URL("./job-main.js", import.meta.url));
        // execArgv forwards pm2's --max-old-space-size to the prover child.
        const child = spawn(
            process.execPath,
            [...process.execArgv, entry, fromActionState],
            { stdio: "inherit" },
        );

        let killedByTimeout = false;
        const killer = setTimeout(() => {
            killedByTimeout = true;
            child.kill("SIGKILL");
        }, WORKER_TIMEOUT_MS);

        child.once("error", (error) => {
            clearTimeout(killer);
            reject(error);
        });
        child.once("exit", (code, signal) => {
            clearTimeout(killer);
            if (code === 0) return resolve();
            if (code === TRANSIENT_EXIT_CODE) {
                return reject(
                    Object.assign(
                        new Error(`reduce job child reported a transient failure for front ${fromActionState}`),
                        { transient: true },
                    ),
                );
            }
            reject(
                new Error(
                    killedByTimeout
                        ? `reduce job child killed after ${WORKER_TIMEOUT_MS}ms for front ${fromActionState} — prover likely froze`
                        : `reduce job child exited with code ${code}, signal ${signal} for front ${fromActionState}`,
                ),
            );
        });
    });
}

export class BridgeTxSenderMaster extends Master<BridgeTxJob> {
    private ctx!: MinaClientContext;

    constructor() {
        super({
            queueName: "bridge-tx-sender",
            workerLabel: "BridgeTxSender",
            connection,
            workerCount: 1, // sıralı çalışmalı, her reduce bir sonraki için actionState'i günceller
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await runReduceJobInChild(job.data.fromActionState);
            },
            onJobFailed: async (job, error) => {
                // Environmental failures (archive lag/outage) heal on retry —
                // charging them to the front's budget would let a seconds-long
                // blip trip the circuit breaker against a healthy front.
                if ((error as { transient?: boolean } | undefined)?.transient) {
                    logger.warn("Transient reduce failure — retrying without a strike", {
                        fromActionState: job?.data.fromActionState,
                        error,
                        event: "bridge_tx_transient_failure",
                    });
                    return;
                }
                try {
                    const updated = await BridgeStateModel.findOneAndUpdate(
                        {},
                        FAILURE_BOOKKEEPING_PIPELINE,
                        { returnDocument: "after", updatePipeline: true },
                    );
                    if ((updated?.txFailCount ?? 0) >= MAX_FAIL_COUNT) {
                        logger.error(
                            "Reduce of the current queue front is permanently failing",
                            {
                                fromActionState: job?.data.fromActionState,
                                failCount: updated?.txFailCount,
                                event: "bridge_tx_failed",
                            },
                        );
                    }
                } catch (error) {
                    // BullMQ does not await this listener — an unhandled throw
                    // here would be an unhandled rejection, not a job failure.
                    logger.error("Failed to record bridge TX job failure", {
                        fromActionState: job?.data.fromActionState,
                        error,
                        event: "bridge_tx_fail_bookkeeping_error",
                    });
                }
            },
        });
    }

    async onStartup(): Promise<void> {

        this.ctx = await initMinaClientContext();

        // An attempt still flagged active at boot was killed mid-flight
        // (crash/OOM). BullMQ's deferred-failure evidence dies with the
        // obliterate below, so book the failure here — otherwise a block of
        // actions that deterministically crashes the process retries forever
        // with txFailCount stuck at 0.
        const state = await BridgeStateModel.findOne();
        if (state?.txAttemptActive) {
            const updated = await BridgeStateModel.findOneAndUpdate(
                {},
                FAILURE_BOOKKEEPING_PIPELINE,
                { returnDocument: "after", updatePipeline: true },
            );
            logger.warn("Booked interrupted reduce attempt on startup", {
                txAttemptActionState: state.txAttemptActionState,
                failCount: updated?.txFailCount,
                event: "stuck_attempt_booked",
            });
        }

        const queue = new Queue("bridge-tx-sender", { connection });
        await queue.obliterate({ force: true });
        await queue.close();

        // No compile here: proving happens in the per-job child process
        // (job-main.ts), which compiles from the shared on-disk cache. The
        // master itself never proves, so it stays small and un-freezable.
    }

    async handleTask(): Promise<void> {
        const counts = await bridgeTxSenderQ.getJobCounts(
            "waiting",
            "active",
            "delayed",
        );
        if (counts.waiting + counts.active + counts.delayed > 0) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        try {
            await refreshContractState(this.ctx);
        } catch (error) {
            logger.error("Failed to refresh contract state", {
                error,
                event: "contract_state_refresh_error",
            });
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        // Pending-work signal: the contract's processed pointer (state[0])
        // versus the account's live action queue tip. Equal → fully reduced.
        const processed = getContractActionState(this.ctx);
        const queueTip = getActionStateHistory(this.ctx)[0];
        if (processed === queueTip) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        // Durable circuit breaker: the same queue front failing repeatedly is
        // a deterministic failure — retrying only burns fees, and skipping is
        // impossible (each reduce chains the actionState). Recovery: fix the
        // cause and reset txFailCount in BridgeState, or the front advances
        // on its own (e.g. another bridge instance reduced it).
        const bridgeState = await getBridgeState();
        if (
            bridgeState.txFailCount >= MAX_FAIL_COUNT &&
            bridgeState.txAttemptActionState === processed
        ) {
            logger.error(
                "Master halted: reducing the current queue front has permanently failed. Manual intervention required.",
                {
                    fromActionState: processed,
                    failCount: bridgeState.txFailCount,
                    event: "master_halted_failed_front",
                },
            );
            await sleep(MASTER_SLEEP_INTERVAL_MS * 60);
            return;
        }

        // Exponential backoff between retries of a front that already has
        // strikes — without it, MAX_FAIL_COUNT is consumable within seconds.
        if (
            bridgeState.txFailCount > 0 &&
            bridgeState.txAttemptActionState === processed
        ) {
            await sleep(
                Math.min(
                    MASTER_SLEEP_INTERVAL_MS * 2 ** bridgeState.txFailCount,
                    MASTER_SLEEP_INTERVAL_MS * 60,
                ),
            );
        }

        try {
            await bridgeTxSenderQ.add("bridge-tx-sender", {
                fromActionState: processed,
            });
            logger.info("Queued reduce job for pending actions", {
                fromActionState: processed,
                queueTip,
                event: "bridge_tx_queued",
            });
        } catch (error) {
            // Nothing to revert — no state was claimed. Retry next tick.
            logger.error("Failed to queue reduce job", {
                error,
                event: "bridge_tx_queue_error",
            });
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new BridgeTxSenderMaster();
    await master.run();
}
