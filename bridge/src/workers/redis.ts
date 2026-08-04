import IORedis from "ioredis";
import { env } from "../config/env.js";

const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

export { connection };
