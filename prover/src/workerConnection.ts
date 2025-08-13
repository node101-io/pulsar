import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import { BlockData } from "./interfaces.js";
dotenv.config();

export {
    connection,
    settlementQ,
    mergeQ,
    reduceQ,
    collectSignatureQ,
    SettlementJob,
    MergeJob,
    ReducerJob,
    CollectSignatureJob,
    QueueName,
};

const connection = new IORedis({
    host: process.env.REDIS_HOST ?? "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

interface SettlementJob {
    blockData: BlockData;
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
    includedActions: Map<string, number>;
    signaturePubkeyArray: Array<[string, string]>;
    actions: {
        actions: string[][];
        hash: string;
    }[];
}

interface CollectSignatureJob {
    blockHeight: number;
    actions: {
        actions: string[][];
        hash: string;
    }[];
}

const settlementQ = new Queue("settlement", { connection });
const mergeQ = new Queue("merge", { connection });
const reduceQ = new Queue("reduce", { connection });
const collectSignatureQ = new Queue("collect-signature", { connection });

type QueueName = "settlement" | "merge" | "reduce" | "collect-signature";
