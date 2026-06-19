import { Queue } from "bullmq";
import { connection } from "./workers/redis.js";
import { MinaActionModel } from "./db/models/MinaAction.js";
import { MAX_FAIL_COUNT } from "./config/constants.js";
import logger from "./common/logger.js";

async function clearQueues() {
    const queue = new Queue("bridge-tx-sender", { connection });
    await queue.obliterate({ force: true });
    await queue.close();
    logger.info("Bridge TX queue cleared", { event: "queue_cleared" });
}

async function resetStuckBlocks() {
    await MinaActionModel.updateMany(
        { status: "submitted" },
        { $set: { status: "pending" } },
    );
    logger.info("Stuck submitted blocks reset to pending", { event: "stuck_blocks_reset" });
}

async function markFailedBlocks() {
    const { modifiedCount } = await MinaActionModel.updateMany(
        { failCount: { $gte: MAX_FAIL_COUNT }, status: { $ne: "failed" } },
        { $set: { status: "failed" } },
    );
    if (modifiedCount > 0) {
        logger.warn("Failed blocks marked on startup", {
            count: modifiedCount,
            event: "failed_blocks_marked",
        });
    }
}

export async function runStartup() {
    logger.info("Running startup procedures", { event: "startup_begin" });
    await clearQueues();
    await resetStuckBlocks();
    await markFailedBlocks();
    logger.info("Startup procedures completed", { event: "startup_complete" });
}
