import logger from "../../logger.js";
import { BlockEpochModel } from "../db/models/blockEpoch/BlockEpoch.js";
import { ProofEpochModel } from "../db/models/proofEpoch/ProofEpoch.js";
import { BlockModel } from "../db/models/block/Block.js";
import { ProofModel } from "../db/models/proof/Proof.js";
import {
    CLEANUP_AGE_MS,
    CLEANUP_INTERVAL_MS,
} from "../utils/constants.js";
import { sleep } from "../utils/functions.js";

const cutoff = () => new Date(Date.now() - CLEANUP_AGE_MS);

export async function runCleanup() {
    const before = cutoff();
    let totalDeleted = 0;

    const blockEpochResult = await BlockEpochModel.deleteMany({
        updatedAt: { $lt: before },
    });
    totalDeleted += blockEpochResult.deletedCount;
    if (blockEpochResult.deletedCount > 0) {
        logger.info("Cleanup: deleted block epochs", {
            count: blockEpochResult.deletedCount,
            event: "cleanup_block_epochs",
        });
    }

    const proofEpochResult = await ProofEpochModel.deleteMany({
        updatedAt: { $lt: before },
    });
    totalDeleted += proofEpochResult.deletedCount;
    if (proofEpochResult.deletedCount > 0) {
        logger.info("Cleanup: deleted proof epochs", {
            count: proofEpochResult.deletedCount,
            event: "cleanup_proof_epochs",
        });
    }

    const blockResult = await BlockModel.deleteMany({
        updatedAt: { $lt: before },
    });
    totalDeleted += blockResult.deletedCount;
    if (blockResult.deletedCount > 0) {
        logger.info("Cleanup: deleted blocks", {
            count: blockResult.deletedCount,
            event: "cleanup_blocks",
        });
    }

    const proofResult = await ProofModel.deleteMany({
        updatedAt: { $lt: before },
    });
    totalDeleted += proofResult.deletedCount;
    if (proofResult.deletedCount > 0) {
        logger.info("Cleanup: deleted proofs", {
            count: proofResult.deletedCount,
            event: "cleanup_proofs",
        });
    }

    if (totalDeleted > 0) {
        logger.info("Cleanup completed", {
            totalDeleted,
            event: "cleanup_completed",
        });
    }

    return totalDeleted;
}

async function cleanupLoop() {
    while (true) {
        try {
            await runCleanup();
        } catch (error) {
            logger.error("Error during cleanup", error as Error, {
                event: "cleanup_error",
            });
        }

        await sleep(CLEANUP_INTERVAL_MS);
    }
}

export async function startCleanup() {
    logger.info("Starting cleanup", {
        cleanupAgeMs: CLEANUP_AGE_MS,
        intervalMs: CLEANUP_INTERVAL_MS,
        event: "cleanup_start",
    });

    await cleanupLoop();
}
