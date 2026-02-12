// constants imports
import { WORKER_COUNT } from "../../utils/constants.js";

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
import { WORKER_TIMEOUT_MS } from "../../utils/constants.js";

// logger imports
import logger from "../../../logger.js";

const queue = blockProverQ;

interface WorkerInfo {
    worker: Worker<BlockProverJob>;
    lastFinishTime: Date | null;
    lastStartTime: Date | null;
}

const workers: WorkerInfo[] = [];

async function initializeWorkers() {
    for (let i = 0; i < WORKER_COUNT; i++) {
        await createWorker(i);
    }
    logger.info(`Initialized ${WORKER_COUNT} workers for block-prover queue`);
}

async function createWorker(workerId: number) {
    const workerInfo: WorkerInfo = {
        worker: new Worker<BlockProverJob>(
            "block-prover",
            async (job) => {
                // Update this worker's start time
                workerInfo.lastStartTime = new Date();
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
            },
        ),
        lastFinishTime: null,
        lastStartTime: null,
    };

    const worker = workerInfo.worker;

    // Event listeners
    worker.on("completed", (job) => {
        workerInfo.lastFinishTime = new Date();
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
        // Remove old worker from array
        const index = workers.findIndex((w) => w === workerInfo);
        if (index !== -1) {
            workers.splice(index, 1);
        }
        // Create replacement worker
        await createWorker(workerId);
    });

    workers.push(workerInfo);
    return worker;
}

function checkWorkers() {
    const now = Date.now();
    for (let i = 0; i < workers.length; i++) {
        const workerInfo = workers[i];

        const { lastFinishTime, lastStartTime } = workerInfo;
        if (
            lastStartTime &&
            !lastFinishTime &&
            now - lastStartTime.getTime() > WORKER_TIMEOUT_MS
        ) {
            logger.warn(
                `Worker ${i} appears stuck (started ${now - lastStartTime.getTime()}ms ago), closing`,
            );
            workerInfo.worker.close();
            workers.splice(i, 1);
        }
    }
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

    checkWorkers();

    if (epoch) {
        const epochHeight = epoch.height;

        await queue.add("block-prover", { height: epochHeight });
        logger.debug(
            `Pushed epoch task to queue: epoch starting at height ${epochHeight}`,
            {
                epochHeight,
                event: "epoch_task_queued",
            },
        );
    } else {
        await sleep(1000);
    }

    handleTask();
}

export async function masterRunner() {
    await initializeWorkers();
    handleTask();
}
