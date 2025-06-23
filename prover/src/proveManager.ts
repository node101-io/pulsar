import { PublicKey } from "o1js";
import { compileContracts, setMinaNetwork } from "./utils.js";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import logger from "./logger.js";
import dotenv from "dotenv";
dotenv.config();

/**
 * Finalizer Node:
 * - Listen Mina network for actions
 * - Prepare and sign Action Queue
 * - Generate Settlement Proofs
 * - Send Settlement Transactions
 * - Generate and send Reduce Proofs
 *
 * Validator Node:
 * - Listen Light Client
 * - Listen Action State
 * - Validate and sign actions
 */

const redisHost = process.env.REDIS_HOST || "redis";
const redisPort = process.env.REDIS_PORT || "6379";
const settlementContractAddress = PublicKey.fromBase58(
    process.env.SETTLEMENT_CONTRACT_ADDRESS || ""
);

console.log("Connecting to Redis at", redisHost, redisPort);

const connection = new IORedis({
    host: redisHost,
    port: parseInt(redisPort),
    password: process.env.REDIS_PASSWRD,
    maxRetriesPerRequest: null,
});

async function main() {
    logger.info("Initializing worker");
    setMinaNetwork();

    await compileContracts();
    logger.info("Contracts compiled");

    const worker = new Worker(
        `proofQueue${settlementContractAddress.toBase58()}`,
        async (job) => {
            logger.info(`Processing job ${job.id}`);
        },
        {
            connection,
            concurrency: 1,
            lockDuration: 60000,
        }
    );

    worker.on("completed", (job) => {
        logger.info(`Job ${job.id} has completed`);
    });

    worker.on("failed", (job) => {
        logger.error(`Job has failed with error: ${job?.failedReason}`);
    });

    worker.on("error", (err) => {
        logger.error("Worker error:", err);
    });

    logger.info("Worker is listening for jobs");
}

main().catch((err) => {
    console.error("Failed to initialize worker:", err);
    process.exit(1);
});
