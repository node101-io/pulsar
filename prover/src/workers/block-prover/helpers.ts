import { BlockStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { BlockEpochModel } from "../../db/models/BlockEpoch.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SIZE,
} from "../../config/constants.js";

async function registerBlock(blockEpochHeight: number, index: number) {
    const result = await BlockEpochModel.updateOne(
        {
            height: blockEpochHeight,
            [`status.${index}`]: "waiting" as BlockStatus,
        },
        { $set: { [`status.${index}`]: "processing" as BlockStatus } },
    );

    if (!result.matchedCount) {
        throw new Error(
            `Block at index ${index} in epoch ${blockEpochHeight} is not in 'waiting' status.`,
        );
    }

    logger.info(
        `Registered block at index ${index} in epoch ${blockEpochHeight} as 'processing'.`,
    );
}

/**
 * Height of the proof epoch this block epoch's leaf belongs to.
 *
 * Lives here rather than beside the prover because both sides of the
 * child-process split need it: the parent to check whether its own leaf is
 * already stored, the child to write it.
 */
function proofEpochHeightFor(blockEpochHeight: number): number {
    return (
        EPOCH_START_HEIGHT +
        Math.floor((blockEpochHeight - EPOCH_START_HEIGHT) / PROOF_EPOCH_SIZE) *
            PROOF_EPOCH_SIZE
    );
}

/** Leaf slot this block epoch's proof occupies within its proof epoch. */
function leafIndexFor(blockEpochHeight: number): number {
    return (
        Math.floor((blockEpochHeight - EPOCH_START_HEIGHT) / BLOCK_EPOCH_SIZE) %
        PROOF_EPOCH_LEAF_COUNT
    );
}

export { registerBlock, proofEpochHeightFor, leafIndexFor };
