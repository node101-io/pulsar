#!/usr/bin/env node

import { TestNode } from "../test/integration/testNode.js";
import logger from "../logger.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    const validatorCount = parseInt(process.env.TEST_VALIDATOR_COUNT || "25");
    const blockInterval = parseInt(process.env.TEST_BLOCK_INTERVAL || "5000");
    const grpcPort = parseInt(process.env.TEST_GRPC_PORT || "50051");

    logger.info("Starting test node with configuration", {
        validatorCount,
        blockInterval,
        grpcPort,
    });

    const testNode = new TestNode(validatorCount, blockInterval, grpcPort);

    // Graceful shutdown
    process.on("SIGINT", async () => {
        logger.info("Received SIGINT, shutting down...");
        await testNode.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        logger.info("Received SIGTERM, shutting down...");
        await testNode.stop();
        process.exit(0);
    });

    try {
        await testNode.start();

        // Status log'u periyodik olarak yazdır
        setInterval(() => {
            const status = testNode.getStatus();
            logger.info("Test node status", status);
        }, 30000); // Her 30 saniyede bir
    } catch (error) {
        logger.error("Failed to start test node", error as Error);
        process.exit(1);
    }
}

main().catch((error) => {
    logger.error("Unhandled error in test node", error as Error);
    process.exit(1);
});
