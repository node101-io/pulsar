import { Queue } from "bullmq";
import { connection } from "./workerConnection.js";

const blockProverQ = new Queue("block-prover", { connection });
const aggregatorQ = new Queue("aggregator", { connection });
const settlementProverQ = new Queue("settlement-prover", { connection });
const settlerQ = new Queue("settler", { connection });

type QueueName = "block-prover" | "aggregator" | "settlement-prover" | "settler";

export { blockProverQ, aggregatorQ, settlementProverQ, settlerQ, QueueName };
