import { Worker } from "bullmq";

import {
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
} from "../utils/constants.js";
import { connection } from "./utils/workerConnection.js";
import { BlockProverJob, AggregatorJob, SettlerJob } from "./utils/jobs.js";
import { worker as processBlockProver } from "./block-prover/worker.js";
import { worker as processAggregation } from "./aggregator/worker.js";
import { worker as processSettlement } from "./settler/worker.js";
import { runStartupRecovery } from "./recovery.js";
import logger from "../../logger.js";

export class PipelineManager {
    private workers: Worker[] = [];

    async start(): Promise<void> {
        await runStartupRecovery();

        this.createWorkers(
            "block-prover",
            WORKER_COUNT,
            async (job) => processBlockProver(job.data),
        );

        this.createWorkers(
            "aggregator",
            WORKER_COUNT,
            async (job) => processAggregation(job.data),
        );

        this.createWorkers(
            "settler",
            2,
            async (job) => processSettlement(job.data),
        );

        logger.info(
            `Pipeline started: ${WORKER_COUNT} block-prover, ${WORKER_COUNT} aggregator, 2 settler workers`,
        );
    }

    private createWorkers<T>(
        queueName: string,
        count: number,
        processor: (job: any) => Promise<void>,
    ): void {
        for (let i = 0; i < count; i++) {
            const worker = new Worker(queueName, processor, {
                connection,
                concurrency: 1,
                lockDuration: WORKER_TIMEOUT_MS,
                stalledInterval: STALLED_INTERVAL_MS,
            });

            worker.on("completed", (job) => {
                logger.info(`${queueName} worker ${i} completed job ${job.id}`);
            });

            worker.on("failed", (job, err) => {
                logger.error(
                    `${queueName} worker ${i} failed job ${job?.id} (attempt ${job?.attemptsMade}/${job?.opts.attempts})`,
                    err as Error,
                    { jobId: job?.id, data: job?.data },
                );
            });

            worker.on("error", (err) => {
                logger.error(
                    `${queueName} worker ${i} error`,
                    err as Error,
                );
            });

            this.workers.push(worker);
        }
    }

    async shutdown(): Promise<void> {
        logger.info("Shutting down pipeline workers...");
        await Promise.all(this.workers.map((w) => w.close()));
        logger.info("All pipeline workers shut down.");
    }
}

export async function startPipeline(): Promise<void> {
    const manager = new PipelineManager();

    const shutdown = async () => {
        logger.info("Received shutdown signal");
        await manager.shutdown();
        process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    await manager.start();
}
