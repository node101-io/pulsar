import {
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SETTLEMENT_INDEX,
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
} from "../../utils/constants.js";

// db
import { ProofEpochModel } from "../../db/index.js";

// bullmq
import { Worker } from "bullmq";
import { settlerQ } from "../utils/queue.js";
import { SettlerJob } from "../utils/jobs.js";
import { connection } from "../utils/workerConnection.js";

// settler worker
import { worker as processSettlement } from "./worker.js";

// utils
import { sleep } from "../../utils/functions.js";
import logger from "../../../logger.js";

const queue = settlerQ;

interface WorkerInfo {
    worker: Worker<SettlerJob>;
    lastFinishTime: Date | null;
    lastStartTime: Date | null;
}

const workers: WorkerInfo[] = [];

async function initializeWorkers() {
    for (let i = 0; i < WORKER_COUNT; i++) {
        await createWorker(i);
    }
    logger.info(`Initialized ${WORKER_COUNT} workers for settler queue`);
}

async function createWorker(workerId: number) {
    const workerInfo: WorkerInfo = {
        worker: new Worker<SettlerJob>(
            "settler",
            async (job) => {
                workerInfo.lastStartTime = new Date();
                logger.info(
                    `Settler worker ${workerId} started job ${job.id} for epoch height ${job.data.height}`,
                );

                const epoch = await ProofEpochModel.findOne({
                    height: job.data.height,
                });

                if (!epoch) {
                    logger.warn(
                        `Settler worker ${workerId} could not find epoch at height ${job.data.height}`,
                    );
                    return;
                }

                await processSettlement(epoch);

                workerInfo.lastFinishTime = new Date();
                logger.info(
                    `Settler worker ${workerId} finished job ${job.id} for epoch height ${job.data.height}`,
                );
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

    worker.on("completed", (job) => {
        workerInfo.lastFinishTime = new Date();
        logger.info(
            `Settler worker ${workerId} completed job ${job.id} for epoch height ${job.data.height}`,
        );
    });

    worker.on("failed", (job, err) => {
        logger.error(
            `Settler worker ${workerId} failed job ${job?.id} for epoch height ${job?.data.height}`,
            err as Error,
        );
    });

    worker.on("error", (err) => {
        logger.error(`Settler worker ${workerId} error`, err as Error);
    });

    worker.on("closed", async () => {
        logger.warn(`Settler worker ${workerId} closed, creating replacement`);
        const index = workers.findIndex((w) => w === workerInfo);
        if (index !== -1) workers.splice(index, 1);
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
                `Settler worker ${i} appears stuck (started ${
                    now - lastStartTime.getTime()
                }ms ago), closing`,
            );
            workerInfo.worker.close();
            workers.splice(i, 1);
        }
    }
}

async function handleTask() {
    const epoch = await ProofEpochModel.findOne(
        {
            [`proofs.${PROOF_EPOCH_SETTLEMENT_INDEX}`]: { $exists: true },
            timeoutAt: { $gt: new Date() },
        },
        undefined,
        { sort: { timeoutAt: 1 } },
    );

    checkWorkers();

    if (epoch) {
        await queue.add("settler", { height: epoch.height });
        logger.debug(
            `Pushed settler job to queue for epoch at height ${epoch.height}`,
            {
                epochHeight: epoch.height,
                event: "settler_task_queued",
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
