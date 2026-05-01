import {
    PROOF_EPOCH_SETTLEMENT_INDEX,
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../config/constants.js";
import { ProofKind } from "../../common/types.js";
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";
import { Master } from "../master.js";
import { settlementProverQ } from "../queue.js";
import { SettlementProverJob } from "../types.js";
import { connection } from "../redis.js";
import { worker as processSettlementProof } from "./worker.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";

const EXCLUDED_KINDS: ProofKind[] = ["txProving", "settlement", "txSending", "done"];

export class SettlementProverMaster extends Master<SettlementProverJob> {
    constructor() {
        super({
            queueName: "settlement-prover",
            workerLabel: "Settlement-prover",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processSettlementProof(job.data);
            },
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async onStartup(): Promise<void> {
        const result = await ProofEpochModel.updateMany(
            { kind: "txProving" as ProofKind },
            { $set: { kind: "blockProof" as ProofKind } },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Recovered ${result.modifiedCount} epoch(s) stuck in 'txProving' back to 'blockProof' on startup`,
                { count: result.modifiedCount, event: "tx_proving_recovery" },
            );
        }
    }

    protected async handleTask(): Promise<void> {
        const epoch = await ProofEpochModel.findOneAndUpdate(
            {
                [`proofs.${PROOF_EPOCH_SETTLEMENT_INDEX}`]: { $ne: null },
                kind: { $nin: EXCLUDED_KINDS },
                timeoutAt: { $gt: new Date() },
            },
            {
                $set: { kind: "txProving" as ProofKind },
            },
            {
                sort: { timeoutAt: 1 },
                new: false,
            },
        );

        if (!epoch) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        const settlementProofId = epoch.proofs[PROOF_EPOCH_SETTLEMENT_INDEX];
        if (!settlementProofId) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        try {
            await settlementProverQ.add("settlement-prover", {
                height: epoch.height,
                settlementProofId: settlementProofId.toString(),
            });
            logger.debug(
                `Pushed settlement-prover job to queue for epoch at height ${epoch.height}`,
                { epochHeight: epoch.height, event: "settlement_prover_task_queued" },
            );
        } catch (error) {
            await ProofEpochModel.updateOne(
                { height: epoch.height, kind: "txProving" as ProofKind },
                { $set: { kind: epoch.kind } },
            );
            throw error;
        }
    }
}

export async function masterRunner() {
    const master = new SettlementProverMaster();
    await master.run();
}
