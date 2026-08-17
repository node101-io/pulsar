import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    STALE_CLAIM_TIMEOUT_MS,
    MASTER_SLEEP_INTERVAL_MS,
    MAX_IN_FLIGHT_BLOCK_EPOCHS,
    BLOCK_EPOCH_SIZE,
    PROOF_EPOCH_LEAF_COUNT,
} from "../../config/constants.js";
import { ProofKind } from "../../common/types.js";
import {
    BlockEpochModel,
    ProofEpochModel,
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
                if (job?.data.height !== undefined) {
                    await incrementBlockEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async recoverStaleClaims(): Promise<void> {
        // Healthy proving refreshes updatedAt every block (~seconds), so a
        // quiet claim past the cutoff has a dead owner. Age-gated so that
        // sibling instances never steal each other's live work.
        const cutoff = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS);
        const result = await BlockEpochModel.updateMany(
            { epochStatus: "processing", updatedAt: { $lt: cutoff } },
            { $set: { epochStatus: "waiting" } },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Recovered ${result.modifiedCount} stale 'processing' epoch(s) to 'waiting'`,
                { count: result.modifiedCount, event: "epoch_recovery" },
            );
        }

        // Reconciliation: a done block epoch whose leaf never reached the
        // proof epoch is invisible to the waiting-scan and wedges the proof
        // epoch — and the strictly ordered settle chain behind it — forever.
        // Enforce the invariant "done block epoch ⇒ leaf stored" here as
        // defense in depth; the worker's own-slot skip check is the first
        // line. Age-gated like the rest of the sweep.
        const headEpochs = await ProofEpochModel.find({
            kind: { $in: ["blockProof", "aggregation"] as ProofKind[] },
        });
        for (const proofEpoch of headEpochs) {
            for (let leaf = 0; leaf < PROOF_EPOCH_LEAF_COUNT; leaf++) {
                if (proofEpoch.proofs[leaf]) continue;
                const blockEpochHeight =
                    proofEpoch.height + leaf * BLOCK_EPOCH_SIZE;
                const reset = await BlockEpochModel.updateOne(
                    {
                        height: blockEpochHeight,
                        epochStatus: "done",
                        updatedAt: { $lt: cutoff },
                    },
                    {
                        $set: {
                            epochStatus: "waiting",
                            status: Array(BLOCK_EPOCH_SIZE).fill("waiting"),
                            failCount: 0,
                        },
                    },
                );
                if (reset.modifiedCount > 0) {
                    logger.warn(
                        `Re-queued done block epoch ${blockEpochHeight}: its leaf never reached proof epoch ${proofEpoch.height}`,
                        {
                            blockEpochHeight,
                            proofEpochHeight: proofEpoch.height,
                            leafIndex: leaf,
                            event: "leaf_reconciliation",
                        },
                    );
                }
            }
        }
    }

    protected async handleTask(): Promise<void> {
        // Back-pressure. Until proving moved into a child process, this loop
        // could not run ahead of it — a frozen event loop claims nothing — so
        // exactly one epoch was ever in flight and nothing had to say so. With
        // the loop free, an unbounded claim loop would flip the whole `waiting`
        // backlog (thousands of epochs) to 'processing' within seconds and
        // queue a job per block behind it.
        //
        // Advisory, not a lock: siblings reading the same count can overshoot
        // by at most one epoch each. The atomic status transition below is
        // still what guarantees no two masters take the same epoch.
        const inFlight = await BlockEpochModel.countDocuments({
            epochStatus: "processing",
        });
        if (inFlight >= MAX_IN_FLIGHT_BLOCK_EPOCHS) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

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
                returnDocument: "after",
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
