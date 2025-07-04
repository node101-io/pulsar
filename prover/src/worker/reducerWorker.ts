import { createWorker } from "./worker.js";
import { ReducerJob } from "../workerConnection.js";
import { storeProof } from "../db.js";
import {
    ValidateReduceProof,
    ValidateReduceProgram,
    ValidateReducePublicInput,
} from "pulsar-contracts";
import logger from "../logger.js";

createWorker<ReducerJob, void>({
    queueName: "reduce",
    maxJobsPerWorker: 5,
    jobHandler: async ({ data }) => {
        logger.info(`Processing reduce job: ${data}`);
        const { height } = data;

        const proof = await ValidateReduceProof.dummy(
            ValidateReducePublicInput.default,
            undefined,
            2
        );
        await storeProof(BigInt(height), BigInt(height), "validateReduce", proof);
    },
});
