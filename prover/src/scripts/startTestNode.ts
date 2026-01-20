#!/usr/bin/env node

import { TestProverNode } from "../test/integration/testProverNode.js";
import logger from "../logger.js";
import dotenv from "dotenv";
import { setMinaNetwork } from "pulsar-contracts";
import { Mina } from "o1js";

dotenv.config();

async function main() {
    const validatorCount = parseInt(process.env.TEST_VALIDATOR_COUNT || "25");
    const blockInterval = parseInt(process.env.TEST_BLOCK_INTERVAL || "5000");
    const grpcPort = parseInt(process.env.TEST_GRPC_PORT || "50051");
    const minaNetwork = (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") || "lightnet";
    const minaContractAddress = process.env.CONTRACT_ADDRESS || "";
    const minaRemoteServerUrl = process.env.REMOTE_SERVER_URL || "localhost";

    // Mina network'ü ayarla
    if (process.env.DOCKER) {
        // Docker içindeyse setMinaNetwork kullan
        setMinaNetwork(minaNetwork);
        logger.info(`Mina network set to: ${minaNetwork} (Docker mode)`);
    } else if (minaRemoteServerUrl) {
        // Custom RPC endpoint varsa kullan
        Mina.setActiveInstance(
            Mina.Network({
                mina: `http://${minaRemoteServerUrl}:8080/graphql`,
                archive: `http://${minaRemoteServerUrl}:8282`,
            })
        );
        logger.info(`Mina network configured with custom endpoint: ${minaRemoteServerUrl}`);
    } else {
        // Default olarak setMinaNetwork kullan
        setMinaNetwork(minaNetwork);
        logger.info(`Mina network set to: ${minaNetwork}`);
    }

    logger.info("Starting test node with configuration", {
        validatorCount,
        blockInterval,
        grpcPort,
        minaNetwork,
        minaContractAddress: minaContractAddress ? `${minaContractAddress.slice(0, 12)}...` : "not set",
        minaRemoteServerUrl,
    });

    const testNode = new TestProverNode({
        validatorCount,
        blockInterval,
        grpcPort,
        minaNetwork,
        minaContractAddress,
        minaRemoteServerUrl,
    });

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

        setInterval(() => {
            const status = testNode.getStatus();
            logger.info("Test node status", status);
        }, 30000);
    } catch (error) {
        logger.error("Failed to start test node", error as Error);
        process.exit(1);
    }
}

main().catch((error) => {
    logger.error("Unhandled error in test node", error as Error);
    process.exit(1);
});
