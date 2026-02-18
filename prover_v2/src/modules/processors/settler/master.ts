import {
    PROOF_EPOCH_SETTLEMENT_INDEX,
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
} from "../../utils/constants.js";
import { ProofKind } from "../../db/types.js";
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";
import { Master } from "../base/Master.js";
import { settlerQ } from "../utils/queue.js";
import { SettlerJob } from "../utils/jobs.js";
import { connection } from "../utils/workerConnection.js";
import { worker as processSettlement } from "./worker.js";
import { sleep } from "../../utils/functions.js";
import logger from "../../../logger.js";

class SettlerMaster extends Master<SettlerJob> {
    constructor() {
        super({
            queueName: "settler",
            workerLabel: "Settler",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processSettlement(job.data);
            },
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async handleTask(): Promise<void> {
        const epoch = await ProofEpochModel.findOne(
            {
                [`proofs.${PROOF_EPOCH_SETTLEMENT_INDEX}`]: { $ne: null },
                kind: { $ne: "done" as ProofKind },
                timeoutAt: { $gt: new Date() },
            },
            undefined,
            { sort: { timeoutAt: 1 } },
        );

        if (epoch) {
            const settlementProofId = epoch.proofs[PROOF_EPOCH_SETTLEMENT_INDEX];
            if (!settlementProofId) {
                await sleep(1000);
                return;
            }

            await settlerQ.add("settler", {
                height: epoch.height,
                settlementProofId: settlementProofId.toString(),
            });
            logger.debug(
                `Pushed settler job to queue for epoch at height ${epoch.height}`,
                { epochHeight: epoch.height, event: "settler_task_queued" },
            );
        } else {
            await sleep(1000);
        }
    }
}

export async function masterRunner() {
    const master = new SettlerMaster();
    await master.run();
}
