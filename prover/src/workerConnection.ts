import { Queue } from "bullmq";
import IORedis from "ioredis";

export { connection, settleQ, mergeQ, reduceQ, QueueName };

const connection = new IORedis({
    host: process.env.REDIS_HOST ?? "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWRD,
    maxRetriesPerRequest: null,
});

const settleQ = new Queue("settlement", { connection });
const mergeQ = new Queue("merge", { connection });
const reduceQ = new Queue("reduce", { connection });

type QueueName = "settlement" | "merge" | "reduce";
