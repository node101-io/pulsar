import { Job, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { STALE_SWEEP_INTERVAL_MS } from "../config/constants.js";
import logger from "../common/logger.js";

export interface MasterConfig<JobData> {
    // queue name (same as Worker queue name)
    queueName: string;
    // label for logs (e.g. "block-prover", "aggregator", "settler")
    workerLabel: string;
    connection: ConnectionOptions;
    workerCount: number;
    lockDurationMs: number;
    stalledIntervalMs: number;
    // process a single job (called by each worker)
    processJob: (
        workerId: number,
        job: Job<JobData, void, string>,
    ) => Promise<void>;
    // called when a job fails (e.g. increment fail count); the error lets
    // handlers tell a transport failure from a real verdict
    onJobFailed?: (
        job: Job<JobData, void, string> | undefined,
        error?: Error,
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

    /**
     * Periodic recovery of claims whose owner died. Overrides MUST gate on
     * claim age (updatedAt older than STALE_CLAIM_TIMEOUT_MS): several
     * instances of one master may share the queue, so an unconditional
     * reset would steal work a sibling process is actively doing — the
     * historical unconditional on-startup reset did exactly that under
     * `pm2 scale`, and a flapping instance repeated it on every restart.
     * Runs once right after startup and then every STALE_SWEEP_INTERVAL_MS.
     */
    protected async recoverStaleClaims(): Promise<void> {}

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
                    `${workerLabel} worker ${workerId} started job ${job.id} for job data`,
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
            if (onJobFailed && job) await onJobFailed(job, err);
            logger.error(
                `${workerLabel} worker ${workerId} failed job ${job?.id}`,
                { errorMessage: err?.message, stack: err?.stack, jobId: job?.id, data: job?.data },
            );
        });

        worker.on("error", (err) => {
            logger.error(
                `${workerLabel} worker ${workerId} error`,
                { errorMessage: err?.message, stack: err?.stack },
            );
        });

        worker.on("closed", async () => {
            logger.warn(
                `${workerLabel} worker ${workerId} closed (crashed or manually closed), creating replacement`,
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
        logger.info(
            `Initialized ${workerCount} workers for ${workerLabel} queue`,
        );
    }

    async run(): Promise<never> {
        await this.onStartup();
        await this.initializeWorkers();
        let lastSweepAt = 0;
        while (true) {
            if (Date.now() - lastSweepAt >= STALE_SWEEP_INTERVAL_MS) {
                lastSweepAt = Date.now();
                try {
                    await this.recoverStaleClaims();
                } catch (error) {
                    logger.error(
                        `${this.config.workerLabel} stale-claim sweep failed`,
                        {
                            errorMessage:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            event: "stale_sweep_error",
                        },
                    );
                }
            }
            await this.handleTask();
        }
    }
}
