import { AGGREGATE_THRESHOLD, MergeSettlementProofs, SettlementProof } from "pulsar-contracts";
import { MergeJob, submitQ } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { deleteProof, fetchProof, storeProof } from "../db.js";
import logger from "../logger.js";
import dotenv from "dotenv";
dotenv.config();

createWorker<MergeJob, void>({
    queueName: "merge",
    maxJobsPerWorker: 10,
    jobHandler: async ({ data }) => {
        const { lowerBlock, upperBlock } = data;

        if (
            upperBlock.rangeHigh - lowerBlock.rangeLow > AGGREGATE_THRESHOLD ||
            upperBlock.rangeLow !== lowerBlock.rangeHigh
        ) {
            logger.warn(
                `invalid merge job: upper : ${upperBlock.rangeLow} - ${upperBlock.rangeHigh}, lower: ${lowerBlock.rangeLow} - ${lowerBlock.rangeHigh}`
            );
            throw new Error(`Invalid merge job`);
        }

        try {
            const lowerProof = (await fetchProof(
                "settlement",
                lowerBlock.rangeLow,
                lowerBlock.rangeHigh
            )) as SettlementProof;
            const upperProof = (await fetchProof(
                "settlement",
                upperBlock.rangeLow,
                upperBlock.rangeHigh
            )) as SettlementProof;

            const mergeProof = await MergeSettlementProofs([lowerProof, upperProof]);

            await storeProof(lowerBlock.rangeLow, upperBlock.rangeHigh, "settlement", mergeProof);
            logger.info(
                `Merged settlement proofs for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
            );
            await deleteProof("settlement", lowerBlock.rangeLow, lowerBlock.rangeHigh);
            await deleteProof("settlement", upperBlock.rangeLow, upperBlock.rangeHigh);

            logger.info(
                `Deleted old proofs for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
            );

            if (
                mergeProof.publicOutput.numberOfSettlementProofs.toBigInt() ===
                BigInt(AGGREGATE_THRESHOLD)
            ) {
                logger.info(
                    `Queueing submission for fully merged proof: blocks ${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`
                );

                await submitQ.add(
                    `submit-${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                    {
                        rangeLow: lowerBlock.rangeLow,
                        rangeHigh: upperBlock.rangeHigh,
                    },
                    {
                        attempts: 10,
                        backoff: {
                            type: "exponential",
                            delay: 10_000,
                        },
                        removeOnComplete: true,
                    }
                );

                logger.info(
                    `Submission job queued for blocks ${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`
                );
            }
        } catch (e) {
            logger.error(`Failed merge: ${e}`);
            throw e;
        }
    },
});
