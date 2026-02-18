import { Types } from "mongoose";

// constants
import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
} from "../../utils/constants.js";

// db
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";

// bullmq
import { Worker } from "bullmq";
import { aggregatorQ } from "../utils/queue.js";
import { AggregatorJob } from "../utils/jobs.js";
import { connection } from "../utils/workerConnection.js";

// aggregator worker
import { worker as processAggregation } from "./worker.js";

// utils
import { sleep } from "../../utils/functions.js";
import logger from "../../../logger.js";

export interface Aggregation {
    left: Types.ObjectId;
    right: Types.ObjectId;
    index: number;
}

const patterns = [
    // leaf nodes aggregation
    { startNode: 0, aggregated: 0 },
    { startNode: 2, aggregated: 1 },
    { startNode: 4, aggregated: 2 },
    { startNode: 6, aggregated: 3 },
    { startNode: 8, aggregated: 4 },
    { startNode: 10, aggregated: 5 },
    { startNode: 12, aggregated: 6 },
    { startNode: 14, aggregated: 7 },
    // 1st level internal nodes aggregation
    { startNode: 16, aggregated: 8 },
    { startNode: 18, aggregated: 9 },
    { startNode: 20, aggregated: 10 },
    { startNode: 22, aggregated: 11 },
    // 2nd level internal nodes aggregation
    { startNode: 24, aggregated: 12 },
    { startNode: 26, aggregated: 13 },
    // 3rd level internal nodes aggregation (to root)
    { startNode: 28, aggregated: 14 },
];

const queue = aggregatorQ;

const workers: Worker<AggregatorJob>[] = [];

async function initializeWorkers() {
    for (let i = 0; i < WORKER_COUNT; i++) {
        await createWorker(i);
    }
    logger.info(`Initialized ${WORKER_COUNT} workers for aggregator queue`);
}

async function createWorker(workerId: number) {
    const worker = new Worker<AggregatorJob>(
        "aggregator",
        async (job) => {
            logger.info(
                `Aggregator worker ${workerId} started job ${job.id} for epoch height ${job.data.height}`,
            );

            const epoch = await ProofEpochModel.findOne({
                height: job.data.height,
            });

            if (!epoch) {
                logger.warn(
                    `Aggregator worker ${workerId} could not find epoch at height ${job.data.height}`,
                );
                return;
            }

            const pattern = patterns.find(
                (p) => p.aggregated === job.data.index,
            );
            if (!pattern) {
                logger.warn(
                    `No aggregation pattern found for index ${job.data.index} on epoch ${epoch.height}`,
                );
                return;
            }

            if (
                !epoch.proofs[pattern.startNode] ||
                !epoch.proofs[pattern.startNode + 1]
            ) {
                logger.warn(
                    `Aggregation slot invalid for epoch ${epoch.height}, index ${job.data.index}`,
                );
                return;
            }

            const aggregation: Aggregation = {
                left: epoch.proofs[pattern.startNode] as Types.ObjectId,
                right: epoch.proofs[
                    pattern.startNode + 1
                ] as Types.ObjectId,
                index: job.data.index,
            };

            await processAggregation(epoch, aggregation);

            logger.info(
                `Aggregator worker ${workerId} finished job ${job.id} for epoch height ${job.data.height}`,
            );
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
            `Aggregator worker ${workerId} completed job ${job.id} for epoch height ${job.data.height}`,
        );
    });

    worker.on("failed", async (job, err) => {
        if (job?.data.height) {
            await incrementProofEpochFailCount(job.data.height);
        }
        logger.error(
            `Aggregator worker ${workerId} failed job ${job?.id} for epoch height ${job?.data.height}`,
            err as Error,
        );
    });

    worker.on("error", (err) => {
        logger.error(`Aggregator worker ${workerId} error`, err as Error);
    });

    worker.on("closed", async () => {
        logger.warn(
            `Aggregator worker ${workerId} closed, creating replacement`,
        );
        const index = workers.indexOf(worker);
        if (index !== -1) workers.splice(index, 1);
        await createWorker(workerId);
    });

    workers.push(worker);
    return worker;
}

async function handleTask() {
    const orClauses = patterns.map((p) => ({
        $and: [
            { [`proofs.${p.startNode}`]: { $ne: null } },
            { [`proofs.${p.startNode + 1}`]: { $ne: null } },
            { [`status.${p.aggregated}`]: { $eq: "waiting" } },
        ],
    }));

    const epoch = await ProofEpochModel.findOne(
        {
            $or: orClauses,
            timeoutAt: { $gt: new Date() },
        },
        undefined,
        { sort: { timeoutAt: 1 } },
    );

    if (epoch) {
        const availablePatterns = patterns.filter(
            (p) =>
                epoch.proofs[p.startNode] &&
                epoch.proofs[p.startNode + 1] &&
                epoch.status[p.aggregated] === "waiting",
        );

        if (availablePatterns.length === 0) {
            logger.warn(
                `Epoch ${epoch.height} matched query but has no valid aggregation slots, skipping`,
            );
            await sleep(1000);
        } else {
            for (const p of availablePatterns) {
                await queue.add("aggregator", {
                    height: epoch.height,
                    index: p.aggregated,
                });
                logger.debug(
                    `Pushed aggregator job for epoch ${epoch.height}, aggregation index ${p.aggregated}`,
                    {
                        epochHeight: epoch.height,
                        index: p.aggregated,
                        event: "aggregator_task_queued",
                    },
                );
            }
        }
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
