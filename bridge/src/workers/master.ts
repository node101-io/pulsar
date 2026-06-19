import { Job, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import logger from "../common/logger.js";

export interface MasterConfig<JobData> {
    queueName: string;
    workerLabel: string;
    connection: ConnectionOptions;
    workerCount: number;
    lockDurationMs: number;
    stalledIntervalMs: number;
    processJob: (
        workerId: number,
        job: Job<JobData, void, string>,
    ) => Promise<void>;
    onJobFailed?: (
        job: Job<JobData, void, string> | undefined,
    ) => Promise<void>;
}

export abstract class Master<JobData> {
    protected readonly config: MasterConfig<JobData>;
    protected readonly workers: Worker<JobData, void, string>[] = [];

    constructor(config: MasterConfig<JobData>) {
        this.config = config;
    }

    protected abstract handleTask(): Promise<void>;

    protected async onStartup(): Promise<void> {}

    protected async createWorker(
        workerId: number,
    ): Promise<Worker<JobData, void, string>> {
        const {
            queueName,
            workerLabel,
            connection,
            lockDurationMs,
            stalledIntervalMs,
            processJob,
            onJobFailed,
        } = this.config;

        const worker = new Worker<JobData, void, string>(
            queueName,
            async (job) => {
                logger.info(
                    `${workerLabel} worker ${workerId} started job ${job.id}`,
                    { jobId: job.id, data: job.data },
                );
                await processJob(workerId, job);
                logger.info(
                    `${workerLabel} worker ${workerId} finished job ${job.id}`,
                    { jobId: job.id },
                );
            },
            {
                connection,
                concurrency: 1,
                lockDuration: lockDurationMs,
                stalledInterval: stalledIntervalMs,
            },
        );

        worker.on("completed", (job) => {
            logger.info(
                `${workerLabel} worker ${workerId} completed job ${job.id}`,
                { jobId: job?.id },
            );
        });

        worker.on("failed", async (job, err) => {
            if (onJobFailed && job) await onJobFailed(job);
            logger.error(
                `${workerLabel} worker ${workerId} failed job ${job?.id}`,
                { errorMessage: err?.message, stack: err?.stack, jobId: job?.id, data: job?.data },
            );
        });

        worker.on("error", (err) => {
            logger.error(`${workerLabel} worker ${workerId} error`, {
                errorMessage: err?.message,
                stack: err?.stack,
            });
        });

        worker.on("closed", async () => {
            logger.warn(
                `${workerLabel} worker ${workerId} closed, creating replacement`,
            );
            const index = this.workers.indexOf(worker);
            if (index !== -1) this.workers.splice(index, 1);
            await this.createWorker(workerId);
        });

        this.workers.push(worker);
        return worker;
    }

    protected async initializeWorkers(): Promise<void> {
        const { workerCount, workerLabel } = this.config;
        for (let i = 0; i < workerCount; i++) {
            await this.createWorker(i);
        }
        logger.info(`Initialized ${workerCount} workers for ${workerLabel} queue`);
    }

    async run(): Promise<never> {
        await this.onStartup();
        await this.initializeWorkers();
        while (true) {
            await this.handleTask();
        }
    }
}
