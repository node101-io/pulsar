import logger from "../../logger.js";
import { MONITOR_INTERVAL_MS } from "../utils/constants.js";
import { blockProverQ, aggregatorQ, settlerQ } from "../processors/utils/queue.js";
import { sleep } from "../utils/functions.js";

export async function checkQueueHealth() {
    const queues = [
        { name: "block-prover", queue: blockProverQ },
        { name: "aggregator", queue: aggregatorQ },
        { name: "settler", queue: settlerQ },
    ];

    for (const { name, queue } of queues) {
        const failedCount = await queue.getFailedCount();
        const waitingCount = await queue.getWaitingCount();
        const activeCount = await queue.getActiveCount();

        if (failedCount > 0) {
            logger.warn(`Queue "${name}" has failed jobs`, {
                queue: name,
                failedCount,
                waitingCount,
                activeCount,
                event: "queue_failed_jobs",
            });
        }
    }
}

async function monitorLoop() {
    while (true) {
        try {
            await checkQueueHealth();
        } catch (error) {
            logger.error("Error during monitor check", error as Error, {
                event: "monitor_error",
            });
        }

        await sleep(MONITOR_INTERVAL_MS);
    }
}

export async function startMonitor() {
    logger.info("Starting queue health monitor", {
        intervalMs: MONITOR_INTERVAL_MS,
        event: "monitor_start",
    });

    await monitorLoop();
}
