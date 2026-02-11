import { Queue } from "bullmq";
import { connection } from "./workerConnection.js";

const blockProverQ = new Queue("block-prover", { connection });
const aggregatorQ = new Queue("aggregator", { connection });
const settlerQ = new Queue("settler", { connection });

type QueueName = "block-prover" | "aggregator" | "settler";

export { blockProverQ, aggregatorQ, settlerQ, QueueName };
