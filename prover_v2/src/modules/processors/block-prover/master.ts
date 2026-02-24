import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../utils/constants.js";
import { BlockEpochModel, incrementBlockEpochFailCount } from "../../db/index.js";
import { Master } from "../base/Master.js";
import { connection } from "../utils/workerConnection.js";
import { blockProverQ } from "../utils/queue.js";
import { BlockProverJob } from "../utils/jobs.js";
import { sleep } from "../../utils/functions.js";
import logger from "../../../logger.js";
import { worker as processTask } from "./worker.js";

class BlockProverMaster extends Master<BlockProverJob> {
    constructor() {
        super({
            queueName: "block-prover",
            workerLabel: "Block-prover",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_, job) => {
                await processTask({ height: job.data.height });
            },
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementBlockEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async handleTask(): Promise<void> {
        const epoch = await BlockEpochModel.findOneAndUpdate(
            {
                blocks: { $not: { $elemMatch: { $eq: null } } },
                epochStatus: { $eq: "waiting" },
            },
            {
                $set: { epochStatus: "processing" },
            },
            {
                sort: { height: 1 },
                new: true,
            },
        );

        if (epoch) {
            await blockProverQ.add("block-prover", { height: epoch.height });
            logger.debug(
                `Pushed epoch task to queue: epoch starting at height ${epoch.height}`,
                { epochHeight: epoch.height, event: "epoch_task_queued" },
            );
        } else {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new BlockProverMaster();
    await master.run();
}
