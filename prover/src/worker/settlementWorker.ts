import {
    GenerateSettlementProof,
    SettlementProof,
    SettlementPublicInputs,
    SettlementPublicOutputs,
} from "pulsar-contracts";
import { SettlementJob, settlementQ } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { storeProof } from "../db.js";
import logger from "../logger.js";
import dotenv from "dotenv";
dotenv.config();

createWorker<SettlementJob, void>({
    queueName: "settlement",
    maxJobsPerWorker: 5,
    jobHandler: async ({ data }) => {
        logger.info(`Processing settlement job: ${JSON.stringify(data)}`);
        const { blocks } = data;

        const proof = await SettlementProof.dummy(
            SettlementPublicInputs.default,
            SettlementPublicOutputs.default,
            2
        );

        await storeProof(BigInt(blocks[0]), BigInt(blocks[blocks.length - 1]), "settlement", proof);
    },
});
