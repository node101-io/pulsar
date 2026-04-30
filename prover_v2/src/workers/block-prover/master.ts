import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
    BLOCK_EPOCH_SIZE,
} from "../../config/constants.js";
import {
    BlockEpochModel,
    incrementBlockEpochFailCount,
} from "../../db/index.js";
import { Master } from "../master.js";
import { connection } from "../redis.js";
import { blockProverQ } from "../queue.js";
import { BlockProverJob } from "../types.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";
import { worker as processTask } from "./worker.js";

export class BlockProverMaster extends Master<BlockProverJob> {
    constructor() {
        super({
            queueName: "block-prover",
            workerLabel: "Block-prover",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_, job) => {
                await processTask({
                    height: job.data.height,
                    blockIndex: job.data.blockIndex,
                });
            },
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementBlockEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async onStartup(): Promise<void> {
        const result = await BlockEpochModel.updateMany(
            { epochStatus: "processing" },
            { $set: { epochStatus: "waiting" } },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Recovered ${result.modifiedCount} stuck epoch(s) from 'processing' to 'waiting' on startup`,
                { count: result.modifiedCount, event: "epoch_recovery" },
            );
        }
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
            try {
                for (let i = 0; i < BLOCK_EPOCH_SIZE; i++) {
                    await blockProverQ.add("block-prover", {
                        height: epoch.height,
                        blockIndex: i,
                    });
                }
                logger.debug(
                    `Pushed ${BLOCK_EPOCH_SIZE} block tasks to queue for epoch at height ${epoch.height}`,
                    { epochHeight: epoch.height, event: "epoch_task_queued" },
                );
            } catch (error) {
                await BlockEpochModel.updateOne(
                    { height: epoch.height, epochStatus: "processing" },
                    { $set: { epochStatus: "waiting" } },
                );
                throw error;
            }
        } else {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new BlockProverMaster();
    await master.run();
}
