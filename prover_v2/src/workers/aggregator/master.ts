import { Types } from "mongoose";
import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../config/constants.js";
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";
import { Master } from "../master.js";
import { aggregatorQ } from "../queue.js";
import { AggregatorJob } from "../types.js";
import { connection } from "../redis.js";
import { worker as processAggregation } from "./worker.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";

export interface Aggregation {
    left: Types.ObjectId;
    right: Types.ObjectId;
    index: number;
}

const patterns = [
    { startNode: 0, aggregated: 0 },
    { startNode: 2, aggregated: 1 },
    { startNode: 4, aggregated: 2 },
    { startNode: 6, aggregated: 3 },
    { startNode: 8, aggregated: 4 },
    { startNode: 10, aggregated: 5 },
    { startNode: 12, aggregated: 6 },
    { startNode: 14, aggregated: 7 },
    { startNode: 16, aggregated: 8 },
    { startNode: 18, aggregated: 9 },
    { startNode: 20, aggregated: 10 },
    { startNode: 22, aggregated: 11 },
    { startNode: 24, aggregated: 12 },
    { startNode: 26, aggregated: 13 },
    { startNode: 28, aggregated: 14 },
];

export class AggregatorMaster extends Master<AggregatorJob> {
    constructor() {
        super({
            queueName: "aggregator",
            workerLabel: "Aggregator",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (workerId, job) => {
                const epoch = await ProofEpochModel.findOne({
                    height: job.data.height,
                });
                if (!epoch) {
                    logger.warn(
                        `Aggregator worker ${workerId} could not find epoch at height ${job.data.height}`,
                    );
                    return;
                }
                const aggregation: Aggregation = {
                    left: new Types.ObjectId(job.data.left),
                    right: new Types.ObjectId(job.data.right),
                    index: job.data.index,
                };
                await processAggregation(epoch, aggregation);
            },
            onJobFailed: async (job) => {
                if (job?.data.height !== undefined) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async onStartup(): Promise<void> {
        const result = await ProofEpochModel.updateMany(
            { status: "processing" },
            { $set: { "status.$[elem]": "waiting" } },
            { arrayFilters: [{ elem: { $eq: "processing" } }] },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Recovered ${result.modifiedCount} epoch(s) with stuck 'processing' aggregation slots on startup`,
                { count: result.modifiedCount, event: "aggregation_slot_recovery" },
            );
        }
    }

    protected async handleTask(): Promise<void> {
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
                await sleep(MASTER_SLEEP_INTERVAL_MS);
            } else {
                for (const p of availablePatterns) {
                    const leftId = epoch.proofs[p.startNode] as Types.ObjectId;
                    const rightId = epoch.proofs[
                        p.startNode + 1
                    ] as Types.ObjectId;
                    const claimed = await ProofEpochModel.updateOne(
                        {
                            _id: epoch._id,
                            [`proofs.${p.startNode}`]: { $ne: null },
                            [`proofs.${p.startNode + 1}`]: { $ne: null },
                            [`status.${p.aggregated}`]: { $eq: "waiting" },
                        },
                        { $set: { [`status.${p.aggregated}`]: "processing" } },
                    );

                    if (!claimed.modifiedCount) continue;

                    try {
                        await aggregatorQ.add("aggregator", {
                            height: epoch.height,
                            index: p.aggregated,
                            left: leftId.toString(),
                            right: rightId.toString(),
                        });
                        logger.debug(
                            `Pushed aggregator job for epoch ${epoch.height}, aggregation index ${p.aggregated}`,
                            {
                                epochHeight: epoch.height,
                                index: p.aggregated,
                                event: "aggregator_task_queued",
                            },
                        );
                    } catch (error) {
                        await ProofEpochModel.updateOne(
                            {
                                _id: epoch._id,
                                [`status.${p.aggregated}`]: {
                                    $eq: "processing",
                                },
                            },
                            {
                                $set: {
                                    [`status.${p.aggregated}`]: "waiting",
                                },
                            },
                        );
                        throw error;
                    }
                }
            }
        } else {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new AggregatorMaster();
    await master.run();
}
