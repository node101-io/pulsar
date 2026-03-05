import { BlockEpochModel, ProofEpochModel } from "../db/index.js";
import {
    BLOCK_EPOCH_SIZE,
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SETTLEMENT_INDEX,
} from "../utils/constants.js";
import { blockProverQ, aggregatorQ, settlerQ } from "./utils/queue.js";
import {
    DEFAULT_JOB_OPTIONS,
    blockProverJobId,
    aggregatorJobId,
    settlerJobId,
} from "./utils/jobOptions.js";
import logger from "../../logger.js";

/**
 * Startup recovery sweep.
 *
 * Scans MongoDB for work that should have been enqueued but wasn't
 * (e.g., server crashed between proof storage and job enqueue).
 *
 * Safe to run at every startup because deterministic job IDs prevent duplicates.
 */
export async function runStartupRecovery(): Promise<void> {
    logger.info("Running startup recovery sweep...");

    let blockProverJobs = 0;
    let aggregatorJobs = 0;
    let settlerJobs = 0;

    // 1. Find full BlockEpochs that don't have a completed ProofEpoch
    const fullBlockEpochs = await BlockEpochModel.find({
        blocks: { $not: { $elemMatch: { $eq: null } } },
    });

    for (const epoch of fullBlockEpochs) {
        const leafIndex =
            (epoch.height / BLOCK_EPOCH_SIZE) % PROOF_EPOCH_LEAF_COUNT;
        const proofEpoch = await ProofEpochModel.findOne({
            height: epoch.height,
        });

        if (!proofEpoch || !proofEpoch.proofs[leafIndex]) {
            await blockProverQ.add(
                "block-prover",
                { height: epoch.height },
                {
                    jobId: blockProverJobId(epoch.height),
                    ...DEFAULT_JOB_OPTIONS,
                },
            );
            blockProverJobs++;
        }
    }

    // 2. Find ProofEpochs with incomplete aggregations
    const proofEpochs = await ProofEpochModel.find({ settled: false });

    for (const pe of proofEpochs) {
        // Check sibling pairs for missing parent aggregations
        for (let i = 0; i < pe.proofs.length - 1; i += 2) {
            if (pe.proofs[i] && pe.proofs[i + 1]) {
                const parentIndex =
                    PROOF_EPOCH_LEAF_COUNT + Math.floor(i / 2);

                if (
                    parentIndex <= PROOF_EPOCH_SETTLEMENT_INDEX &&
                    !pe.proofs[parentIndex]
                ) {
                    const aggIndex = parentIndex - PROOF_EPOCH_LEAF_COUNT;
                    await aggregatorQ.add(
                        "aggregator",
                        {
                            height: pe.height,
                            index: aggIndex,
                            left: pe.proofs[i]!.toString(),
                            right: pe.proofs[i + 1]!.toString(),
                        },
                        {
                            jobId: aggregatorJobId(pe.height, aggIndex),
                            ...DEFAULT_JOB_OPTIONS,
                        },
                    );
                    aggregatorJobs++;
                }
            }
        }

        // 3. Check if root proof exists but not settled
        if (pe.proofs[PROOF_EPOCH_SETTLEMENT_INDEX] && !pe.settled) {
            await settlerQ.add(
                "settler",
                {
                    height: pe.height,
                    settlementProofId:
                        pe.proofs[PROOF_EPOCH_SETTLEMENT_INDEX]!.toString(),
                },
                {
                    jobId: settlerJobId(pe.height),
                    ...DEFAULT_JOB_OPTIONS,
                },
            );
            settlerJobs++;
        }
    }

    logger.info("Startup recovery sweep completed", {
        blockProverJobs,
        aggregatorJobs,
        settlerJobs,
        event: "recovery_sweep_complete",
    });
}
