import { Queue } from "bullmq";
import { connection } from "./modules/processors/utils/workerConnection.js";
import { BlockEpochModel } from "./modules/db/models/blockEpoch/BlockEpoch.js";
import { ProofEpochModel } from "./modules/db/models/proofEpoch/ProofEpoch.js";
import { MAX_FAIL_COUNT } from "./modules/utils/constants.js";
import { BlockStatus, ProofStatus } from "./modules/db/types.js";
import logger from "./logger.js";

const QUEUE_NAMES = [
    "block-prover",
    "aggregator",
    "settlement-prover",
    "settler",
];

async function clearQueues(): Promise<void> {
    await Promise.all(
        QUEUE_NAMES.map(async (name) => {
            const queue = new Queue(name, { connection });
            await queue.obliterate({ force: true });
            await queue.close();
        }),
    );

    logger.info("All queues cleared", { event: "queues_cleared" });
}

async function resetStuckEpochs(): Promise<void> {
    await BlockEpochModel.updateMany(
        { epochStatus: "processing" },
        { $set: { epochStatus: "waiting" as BlockStatus } },
    );

    await BlockEpochModel.updateMany(
        { status: { $elemMatch: { $eq: "processing" } } },
        { $set: { "status.$[elem]": "waiting" as BlockStatus } },
        { arrayFilters: [{ elem: { $eq: "processing" } }] },
    );

    // settlement-prover's lock
    await ProofEpochModel.updateMany(
        { kind: "txProving" },
        { $set: { kind: "aggregation" } },
    );

    // settler's lock
    await ProofEpochModel.updateMany(
        { kind: "txSending" },
        { $set: { kind: "settlement" } },
    );

    logger.info("Stuck epoch states reset", { event: "epochs_reset" });
}

async function markFailedEpochs(): Promise<void> {
    const { modifiedCount: failedBlockCount } =
        await BlockEpochModel.updateMany(
            {
                failCount: { $gt: MAX_FAIL_COUNT },
                epochStatus: { $ne: "failed" },
            },
            { $set: { epochStatus: "failed" as BlockStatus } },
        );

    const failedProofEpochs = await ProofEpochModel.find({
        failCount: { $gt: MAX_FAIL_COUNT },
        status: { $not: { $all: ["failed"] } },
    });

    for (const epoch of failedProofEpochs) {
        const failedStatus: ProofStatus[] = epoch.status.map(
            () => "failed" as ProofStatus,
        );
        await ProofEpochModel.updateOne(
            { height: epoch.height },
            { $set: { status: failedStatus } },
        );
    }

    if (failedBlockCount > 0 || failedProofEpochs.length > 0) {
        logger.warn("Failed epochs marked on startup", {
            failedBlockEpochs: failedBlockCount,
            failedProofEpochs: failedProofEpochs.length,
            event: "failed_epochs_marked",
        });
    }
}

export async function runStartup(): Promise<void> {
    logger.info("Running startup procedures", { event: "startup_begin" });
    await clearQueues();
    await resetStuckEpochs();
    await markFailedEpochs();
    logger.info("Startup procedures completed", { event: "startup_complete" });
}
