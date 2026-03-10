import {
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
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
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async handleTask(): Promise<void> {
        const epoch = await ProofEpochModel.findOneAndUpdate(
            {
                kind: { $eq: "settlement" as ProofKind },
                timeoutAt: { $gt: new Date() },
            },
            {
                $set: { kind: "txSending" as ProofKind },
            },
            {
                sort: { timeoutAt: 1 },
                new: false,
            },
        );

        if (epoch) {
            try {
                await settlerQ.add("settler", {
                    height: epoch.height,
                });
                logger.debug(
                    `Pushed settler job to queue for epoch at height ${epoch.height}`,
                    { epochHeight: epoch.height, event: "settler_task_queued" },
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
