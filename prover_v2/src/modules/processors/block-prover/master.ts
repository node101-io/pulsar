// constants imports
import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
} from "../../utils/constants.js";

// db imports
import {
    BlockEpochModel,
    incrementBlockEpochFailCount,
} from "../../db/index.js";

// bullmq imports
import { Worker } from "bullmq";
import { worker as processTask } from "./worker.js";

// utils imports
import { connection } from "../utils/workerConnection.js";
import { sleep } from "../../utils/functions.js";
import { blockProverQ } from "../utils/queue.js";
import { BlockProverJob } from "../utils/jobs.js";

// logger imports
import logger from "../../../logger.js";

const queue = blockProverQ;

const workers: Worker<BlockProverJob>[] = [];

async function initializeWorkers() {
    for (let i = 0; i < WORKER_COUNT; i++) {
        await createWorker(i);
    }
    logger.info(`Initialized ${WORKER_COUNT} workers for block-prover queue`);
}

async function createWorker(workerId: number) {
    const worker = new Worker<BlockProverJob>(
        "block-prover",
        async (job) => {
            logger.info(
                `Worker ${workerId} started processing job ${job.id} for block height ${job.data.height}`,
            );
            await processTask({
                height: job.data.height,
            } as BlockProverJob);
        },
        {
            connection,
            concurrency: 1,
            lockDuration: WORKER_TIMEOUT_MS,
            stalledInterval: STALLED_INTERVAL_MS,
        },
    );

    worker.on("completed", (job) => {
        logger.info(
            `Worker ${workerId} completed job ${job.id} for block height ${job.data.height}`,
        );
    });

    worker.on("failed", async (job, err) => {
        if (job?.data.height) {
            await incrementBlockEpochFailCount(job.data.height);
        }
        logger.error(
            `Worker ${workerId} failed job ${job?.id} for block height ${job?.data.height}`,
            err as Error,
        );
    });

    worker.on("error", (err) => {
        logger.error(`Worker ${workerId} error`, err as Error);
    });

    worker.on("closed", async () => {
        logger.warn(
            `Worker ${workerId} closed (crashed or manually closed), creating replacement`,
        );
        const index = workers.indexOf(worker);
        if (index !== -1) workers.splice(index, 1);
        await createWorker(workerId);
    });

    workers.push(worker);
    return worker;
}

async function handleTask() {
    const epoch = await BlockEpochModel.findOne(
        {
            blocks: { $not: { $elemMatch: { $eq: null } } },
            epochStatus: { $eq: "waiting" },
        },
        undefined,
        { sort: { height: 1 } },
    );

    if (epoch) {
        await queue.add("block-prover", { height: epoch.height });
        logger.debug(
            `Pushed epoch task to queue: epoch starting at height ${epoch.height}`,
            { epochHeight: epoch.height, event: "epoch_task_queued" },
        );
    } else {
        await sleep(1000);
    }
}

export async function masterRunner() {
    await initializeWorkers();
    while (true) {
        await handleTask();
    }
}
