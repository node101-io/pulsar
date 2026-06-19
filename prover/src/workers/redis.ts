import IORedis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const connection = new IORedis({
    host: process.env.REDIS_HOST ?? "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

type QueueName = "block-prover" | "aggregator" | "settler";

export { connection, QueueName };
