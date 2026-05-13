import { Queue } from "bullmq";
import { connection } from "./redis.js";

const bridgeTxSenderQ = new Queue("bridge-tx-sender", { connection });

export { bridgeTxSenderQ };
