import logger from "../../logger.js";
import { BlockEpochModel } from "../db/models/blockEpoch/BlockEpoch.js";
import { ProofEpochModel } from "../db/models/proofEpoch/ProofEpoch.js";
import { MAX_FAIL_COUNT, MONITOR_INTERVAL_MS } from "../utils/constants.js";
import { BlockStatus, ProofStatus } from "../db/types.js";
import { sleep } from "../utils/functions.js";

export async function checkBlockEpochs() {
    const failedEpochs = await BlockEpochModel.find({
        failCount: { $gt: MAX_FAIL_COUNT },
        epochStatus: { $ne: "failed" },
    });

    for (const epoch of failedEpochs) {
        await BlockEpochModel.updateOne(
            { height: epoch.height },
            { $set: { epochStatus: "failed" as BlockStatus } },
        );

        logger.warn("Block epoch marked as failed", {
            height: epoch.height,
            failCount: epoch.failCount,
            event: "block_epoch_failed",
        });
    }

    return failedEpochs.length;
}

export async function checkProofEpochs() {
    const failedEpochs = await ProofEpochModel.find({
        failCount: { $gt: MAX_FAIL_COUNT },
        status: { $not: { $all: ["failed"] } },
    });

    for (const epoch of failedEpochs) {
        const failedStatus: ProofStatus[] = epoch.status.map(
            () => "failed" as ProofStatus,
        );

        await ProofEpochModel.updateOne(
            { height: epoch.height },
            { $set: { status: failedStatus } },
        );

        logger.warn("Proof epoch marked as failed", {
            height: epoch.height,
            failCount: epoch.failCount,
            kind: epoch.kind,
            event: "proof_epoch_failed",
        });
    }

    return failedEpochs.length;
}

async function monitorLoop() {
    while (true) {
        try {
            const blockEpochCount = await checkBlockEpochs();
            const proofEpochCount = await checkProofEpochs();

            if (blockEpochCount > 0 || proofEpochCount > 0) {
                logger.info("Monitor check completed", {
                    failedBlockEpochs: blockEpochCount,
                    failedProofEpochs: proofEpochCount,
                    event: "monitor_check",
                });
            }
        } catch (error) {
            logger.error("Error during monitor check", error as Error, {
                event: "monitor_error",
            });
        }

        await sleep(MONITOR_INTERVAL_MS);
    }
}

export async function startMonitor() {
    logger.info("Starting monitor", {
        maxFailCount: MAX_FAIL_COUNT,
        intervalMs: MONITOR_INTERVAL_MS,
        event: "monitor_start",
    });

    await monitorLoop();
}
