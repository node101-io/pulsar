import { PublicKey } from "o1js";
import { checkZkappTransaction } from "pulsar-contracts";

import {
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    STALE_CLAIM_TIMEOUT_MS,
    MASTER_SLEEP_INTERVAL_MS,
    MAX_FAIL_COUNT,
    PROOF_EPOCH_SIZE,
    SETTLER_WINDOW,
    SETTLER_STALL_TIMEOUT_MS,
} from "../../config/constants.js";
import { ProofKind } from "../../common/types.js";
import { ProofEpochModel } from "../../db/index.js";
import { resetLastSentNonce } from "../../db/models/MinaState.js";
import { Master } from "../master.js";
import { settlerQ } from "../queue.js";
import { SettlerJob } from "../types.js";
import { connection } from "../redis.js";
import { worker as processSettlement } from "./worker.js";
import { finalizeSettledEpoch } from "./finalize.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";
import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
    getContractBlockHeight,
} from "../../services/mina/client.js";

let minaCtx: MinaClientContext | null = null;

// Failures that say nothing about the PROOF: gateway 502/504s, refused or
// reset connections, and a daemon that has no transition frontier yet
// (Minascan mid-BOOTSTRAP answers sends with exactly those words). Counting
// these toward MAX_FAIL_COUNT threw away a multi-hour settlement proof for
// every third gateway hiccup — the 2026-08-21/22 outage re-proved the same
// epoch in a loop while NO public endpoint could take a send at all.
//
// Deliberately a blacklist, not an allowlist of stale-proof verdicts: an
// error shape nobody anticipated still falls through to the re-prove path,
// so a genuinely stale proof can never wedge the pipeline forever — the
// worst a miss costs is one wasted re-prove.
const TRANSPORT_ERROR =
    /\b50[234]\b|bad gateway|gateway time-?out|service unavailable|econnrefused|econnreset|etimedout|fetch failed|transition frontier/i;

async function getMinaContext(): Promise<MinaClientContext> {
    if (!minaCtx) {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        if (!contractAddress) throw new Error("CONTRACT_ADDRESS is not set");
        const network: MinaNetwork =
            (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";
        minaCtx = await initMinaClientContext(
            PublicKey.fromBase58(contractAddress),
            network,
        );
    }
    return minaCtx;
}

export class SettlerMaster extends Master<SettlerJob> {
    constructor() {
        super({
            queueName: "settler",
            workerLabel: "Settler",
            connection,
            workerCount: 1,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processSettlement(job.data);
            },
            onJobFailed: async (job, error) => {
                if (job?.data.height !== undefined) {
                    if (TRANSPORT_ERROR.test(error?.message ?? "")) {
                        // The proof never reached a daemon that judged it —
                        // hand the epoch straight back to settlement without
                        // advancing the fail counter. Only a real verdict may
                        // push an epoch toward the re-prove path below.
                        await ProofEpochModel.updateOne(
                            {
                                height: job.data.height,
                                kind: "txSending" as ProofKind,
                            },
                            { $set: { kind: "settlement" as ProofKind } },
                        );
                        return;
                    }
                    const updated = await ProofEpochModel.findOneAndUpdate(
                        {
                            height: job.data.height,
                            kind: "txSending" as ProofKind,
                        },
                        {
                            $inc: { failCount: 1 },
                        },
                        { returnDocument: "after" },
                    );
                    if (!updated) return;

                    if (updated.failCount >= MAX_FAIL_COUNT) {
                        // Stale proof — re-prove and reset counter
                        await ProofEpochModel.updateOne(
                            { height: job.data.height },
                            {
                                $set: {
                                    kind: "aggregation" as ProofKind,
                                    provedTxJson: null,
                                    failCount: 0,
                                },
                            },
                        );
                    } else {
                        await ProofEpochModel.updateOne(
                            { height: job.data.height },
                            { $set: { kind: "settlement" as ProofKind } },
                        );
                    }
                }
            },
        });
    }

    protected async recoverStaleClaims(): Promise<void> {
        // A txSending claim normally resolves in seconds (BullMQ redelivers
        // interrupted jobs and the worker re-runs them); a claim still there
        // past the cutoff lost its job — hand it back so handleTask
        // re-claims in order. txSent epochs are NOT touched: their txs live
        // on Mina and the confirm loop owns them, stall recovery included.
        const cutoff = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS);
        const result = await ProofEpochModel.updateMany(
            { kind: "txSending" as ProofKind, updatedAt: { $lt: cutoff } },
            { $set: { kind: "settlement" as ProofKind } },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Returned ${result.modifiedCount} stale txSending epoch(s) to settlement`,
                { count: result.modifiedCount, event: "settler_claim_recovery" },
            );
        }
    }

    /**
     * One pipeline tick: confirm what the chain has passed, recover a stalled
     * head, then top up the send window by claiming the next epoch in order.
     */
    protected async handleTask(): Promise<void> {
        const ctx = await getMinaContext();
        const contractBlockHeight = await getContractBlockHeight(ctx);

        // ── confirm ─────────────────────────────────────────────────────
        // The contract's blockHeight is the single source of truth: any
        // post-proving epoch it has passed IS settled — whoever's tx did it.
        // Covers txSent, epochs pre-settled during proving (provedTxJson
        // null) and claims orphaned by restarts, without touching hashes.
        const passedEpochs = await ProofEpochModel.find({
            kind: {
                $in: ["settlement", "txSending", "txSent"] as ProofKind[],
            },
            height: { $lte: contractBlockHeight - PROOF_EPOCH_SIZE + 1 },
        }).sort({ height: 1 });
        for (const epoch of passedEpochs) {
            await finalizeSettledEpoch(epoch.height);
        }

        // ── stall recovery ──────────────────────────────────────────────
        const oldestUnconfirmed = await ProofEpochModel.findOne({
            kind: "txSent" as ProofKind,
        }).sort({ height: 1 });

        if (
            oldestUnconfirmed?.sentAt &&
            Date.now() - oldestUnconfirmed.sentAt.getTime() >
                SETTLER_STALL_TIMEOUT_MS
        ) {
            const verdict = await checkZkappTransaction(
                oldestUnconfirmed.sentTxHash!,
                ctx.endpoint,
            ).catch(() => null);

            if (verdict?.success) {
                // Included — the contract height just hasn't reflected it
                // yet (indexer lag). Re-arm the timer instead of resetting a
                // healthy pipeline.
                await ProofEpochModel.updateOne(
                    { height: oldestUnconfirmed.height },
                    { $set: { sentAt: new Date() } },
                );
            } else {
                // Failed on-chain or vanished from the pool. Everything
                // behind it is doomed (their preconditions chain onto it) —
                // return the whole tail to settlement. The proofs stay
                // valid, so recovery is re-sending in order, not re-proving.
                const reset = await ProofEpochModel.updateMany(
                    {
                        kind: "txSent" as ProofKind,
                        height: { $gte: oldestUnconfirmed.height },
                    },
                    {
                        $set: {
                            kind: "settlement" as ProofKind,
                            sentTxHash: null,
                            sentNonce: null,
                            sentAt: null,
                        },
                    },
                );
                await resetLastSentNonce();
                logger.warn(
                    `Settle pipeline reset from epoch ${oldestUnconfirmed.height}: ` +
                        `head tx did not land within the stall timeout`,
                    {
                        epochHeight: oldestUnconfirmed.height,
                        txHash: oldestUnconfirmed.sentTxHash,
                        resetCount: reset.modifiedCount,
                        failureReason: verdict?.failureReason ?? "not found",
                        event: "settler_pipeline_reset",
                    },
                );
                return; // re-send from the head on the next tick
            }
        }

        // ── send ────────────────────────────────────────────────────────
        // One outstanding job at a time keeps sends strictly ordered; the
        // broadcast itself is cheap, so the window still fills in seconds.
        const counts = await settlerQ.getJobCounts(
            "waiting",
            "active",
            "delayed",
        );
        const queueSize = counts.waiting + counts.active + counts.delayed;
        const inFlight = await ProofEpochModel.countDocuments({
            kind: { $in: ["txSending", "txSent"] as ProofKind[] },
        });
        if (queueSize > 0 || inFlight >= SETTLER_WINDOW) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        // The next sendable epoch continues the pipeline: the successor of
        // the highest in-flight epoch, or — with nothing in flight — the
        // epoch the contract expects next. Claiming anything later would
        // break the precondition chain and burn its fee with certainty.
        const lastPipelined = await ProofEpochModel.findOne({
            kind: { $in: ["txSending", "txSent"] as ProofKind[] },
        }).sort({ height: -1 });
        const nextHeight = lastPipelined
            ? lastPipelined.height + PROOF_EPOCH_SIZE
            : contractBlockHeight + 1;

        const epoch = await ProofEpochModel.findOneAndUpdate(
            {
                kind: { $eq: "settlement" as ProofKind },
                height: { $eq: nextHeight },
            },
            {
                $set: { kind: "txSending" as ProofKind },
            },
            {
                returnDocument: "before",
            },
        );

        if (epoch) {
            try {
                await settlerQ.add("settler", { height: epoch.height });
                logger.debug(
                    `Pushed settler job to queue for epoch at height ${epoch.height}`,
                    {
                        epochHeight: epoch.height,
                        contractBlockHeight,
                        inFlight,
                        event: "settler_task_queued",
                    },
                );
            } catch (error) {
                await ProofEpochModel.updateOne(
                    { height: epoch.height, kind: "txSending" as ProofKind },
                    { $set: { kind: "settlement" as ProofKind } },
                );
                throw error;
            }
        } else {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new SettlerMaster();
    await master.run();
}
