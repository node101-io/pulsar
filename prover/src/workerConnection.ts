import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import { VoteExt } from "./pulsarClient";
dotenv.config();

export { connection, settlementQ, mergeQ, reduceQ, SettlementJob, MergeJob, ReducerJob, QueueName };

const connection = new IORedis({
    host: process.env.REDIS_HOST ?? "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

interface SettlementJob {
    blockHeight: number;
    voteExts: VoteExt[];
}

interface MergeJob {
    lowerBlock: {
        rangeLow: number;
        rangeHigh: number;
    };
    upperBlock: {
        rangeLow: number;
        rangeHigh: number;
    };
}

interface ReducerJob {
    height: number;
}

const settlementQ = new Queue("settlement", { connection });
const mergeQ = new Queue("merge", { connection });
const reduceQ = new Queue("reduce", { connection });

type QueueName = "settlement" | "merge" | "reduce";
