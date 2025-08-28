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
    jobHandler: async ({ data, id }) => {
        const { lowerBlock, upperBlock } = data;

        if (
            upperBlock.rangeHigh - lowerBlock.rangeLow > AGGREGATE_THRESHOLD ||
            upperBlock.rangeLow !== lowerBlock.rangeHigh
        ) {
            const error = new Error("Invalid merge job");
            logger.error("Invalid merge job parameters", error, {
                jobId: id,
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                aggregateThreshold: AGGREGATE_THRESHOLD,
                event: "invalid_merge_job",
                workerId: "mergeWorker",
            });
            throw error;
        }

        try {
            logger.jobStarted(id, "merge", {
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                workerId: "mergeWorker",
            });

            logger.debug("Fetching settlement proofs", {
                jobId: id,
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                event: "fetching_proofs",
            });

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

            logger.debug("Generating merge proof", {
                jobId: id,
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                event: "generating_merge_proof",
            });

            const mergeProof = await MergeSettlementProofs([lowerProof, upperProof]);

            await storeProof(lowerBlock.rangeLow, upperBlock.rangeHigh, "settlement", mergeProof);

            logger.info("Settlement proofs merged successfully", {
                jobId: id,
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                mergedRange: `${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                event: "proofs_merged",
            });

            await deleteProof("settlement", lowerBlock.rangeLow, lowerBlock.rangeHigh);
            await deleteProof("settlement", upperBlock.rangeLow, upperBlock.rangeHigh);

            logger.dbOperation("proof_cleanup", "settlement", undefined, {
                jobId: id,
                deletedProofs: [
                    `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                    `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                ],
                event: "old_proofs_deleted",
            });

            if (
                mergeProof.publicOutput.numberOfSettlementProofs.toBigInt() ===
                BigInt(AGGREGATE_THRESHOLD)
            ) {
                logger.info("Queueing submission for fully merged proof", {
                    jobId: id,
                    mergedRange: `${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                    numberOfProofs: mergeProof.publicOutput.numberOfSettlementProofs
                        .toBigInt()
                        .toString(),
                    aggregateThreshold: AGGREGATE_THRESHOLD,
                    event: "queueing_submission",
                });

                const priority = lowerBlock.rangeLow + 1;
                await submitQ.add(
                    `submit-${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                    {
                        rangeLow: lowerBlock.rangeLow,
                        rangeHigh: upperBlock.rangeHigh,
                    },
                    {
                        priority,
                        attempts: 100,
                        backoff: {
                            type: "exponential",
                            delay: 10_000,
                        },
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );

                logger.info("Submission job queued successfully", {
                    jobId: id,
                    mergedRange: `${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                    submitJobId: `submit-${lowerBlock.rangeLow}-${upperBlock.rangeHigh}`,
                    priority: priority,
                    event: "submission_job_queued",
                });
            }
        } catch (e) {
            logger.jobFailed(id, "merge", e as Error, {
                lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                workerId: "mergeWorker",
            });
            throw e;
        }
    },
});
