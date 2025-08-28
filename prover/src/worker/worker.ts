import { Worker, Job, Processor, WorkerOptions, AdvancedOptions } from "bullmq";
import { connection, QueueName } from "../workerConnection.js";
import logger from "../logger.js";
import { setMinaNetwork } from "pulsar-contracts";
import { cacheCompile } from "../cache.js";

declare global {
    var __contractsCompiled__: boolean | undefined;
}

export interface CreateWorkerParams<Data, Result> {
    queueName: string;
    jobHandler: Processor<Data, Result, string>;
    maxJobsPerWorker?: number;
    workerOptions?: Omit<WorkerOptions, "connection">;
    backoffStrategy?: AdvancedOptions["backoffStrategy"] | null;
}

export async function createWorker<Data, Result>(params: CreateWorkerParams<Data, Result>) {
    const {
        queueName,
        jobHandler,
        workerOptions = {},
        maxJobsPerWorker = Infinity,
        backoffStrategy = (attempts) => Math.min(2 ** attempts * 1_000, 5 * 60_000),
    } = params;

    let jobsProcessed = 0;
    const workerLogger = logger.child({
        workerType: queueName,
        workerId: `${queueName}-${process.pid}`,
        maxJobsPerWorker,
    });

    workerLogger.info(`Worker initializing for queue "${queueName}"`, {
        event: "worker_initializing",
    });
    if (!globalThis.__contractsCompiled__) {
        workerLogger.info("Starting contract compilation", {
            event: "compilation_start",
            network: process.env.MINA_NETWORK || "devnet",
        });

        const compilationStart = Date.now();
        try {
            setMinaNetwork(
                (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") ?? "devnet"
            );
            await cacheCompile(queueName as QueueName);
            globalThis.__contractsCompiled__ = true;

            const compilationDuration = Date.now() - compilationStart;
            workerLogger.info("Contract compilation completed", {
                event: "compilation_completed",
                duration: compilationDuration,
            });
        } catch (error) {
            workerLogger.error("Contract compilation failed", error as Error, {
                event: "compilation_failed",
                duration: Date.now() - compilationStart,
            });
            throw error;
        }
    }

    workerLogger.info(`Worker ready for queue "${queueName}"`, {
        event: "worker_ready",
    });

    const processor: Processor<Data, Result, string> = async (job: Job<Data, Result, string>) => {
        if (!globalThis.__contractsCompiled__) {
            workerLogger.warn("Contracts not compiled, compiling now (this shouldn't happen)", {
                event: "unexpected_compilation",
                jobId: job.id,
            });
            setMinaNetwork(
                (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") ?? "devnet"
            );
            await cacheCompile(queueName as QueueName);
            globalThis.__contractsCompiled__ = true;
        }

        try {
            const startTime = Date.now();
            workerLogger.jobStarted(job.id!, queueName, {
                jobsProcessed,
                maxJobsPerWorker,
                jobData: job.data,
            });

            const res = await jobHandler(job);
            const duration = Date.now() - startTime;
            jobsProcessed++;

            workerLogger.jobCompleted(job.id!, queueName, duration, {
                jobsProcessed,
                maxJobsPerWorker,
            });

            if (jobsProcessed >= maxJobsPerWorker) {
                workerLogger.info("Worker reached max jobs limit, initiating graceful restart", {
                    event: "worker_restart_initiated",
                    jobsProcessed,
                    maxJobsPerWorker,
                });

                jobsProcessed = 0;
                globalThis.__contractsCompiled__ = false;

                setImmediate(async () => {
                    try {
                        workerLogger.info("Starting worker shutdown", {
                            event: "worker_shutdown_start",
                        });

                        await worker.close();

                        workerLogger.info("Worker shutdown completed, exiting process", {
                            event: "worker_shutdown_completed",
                        });

                        process.exit(0);
                    } catch (shutdownError) {
                        workerLogger.error("Error during worker shutdown", shutdownError as Error, {
                            event: "worker_shutdown_error",
                        });
                        process.exit(1);
                    }
                });
            }
            return res;
        } catch (error) {
            workerLogger.jobFailed(job.id!, queueName, error as Error, {
                jobsProcessed,
                maxJobsPerWorker,
                jobData: job.data,
            });
            throw error;
        }
    };

    const mergedOptions: WorkerOptions = {
        concurrency: 1,
        lockDuration: 15 * 60_000,
        ...workerOptions,
        connection,
        settings: {
            ...(workerOptions.settings as AdvancedOptions),
            backoffStrategy: backoffStrategy ?? undefined,
        },
    };

    const worker = new Worker<Data, Result, string>(queueName, processor, mergedOptions);

    worker.on("completed", (job) =>
        logger.info(
            `[${queueName}] job ${job.id} completed in ${job.finishedOn! - job.processedOn!} ms`
        )
    );

    worker.on("failed", (job, err) => {
        workerLogger.error(`Job failed`, err as Error, {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            event: "job_failed_event",
        });
    });

    worker.on("error", (err) => {
        workerLogger.error("Worker error occurred", err as Error, {
            event: "worker_error",
        });
    });

    process.on("SIGTERM", async () => {
        workerLogger.info("Received SIGTERM, shutting down gracefully", {
            event: "sigterm_received",
        });
        await worker.close();
        process.exit(0);
    });

    process.on("SIGINT", async () => {
        workerLogger.info("Received SIGINT, shutting down gracefully", {
            event: "sigint_received",
        });
        await worker.close();
        process.exit(0);
    });

    workerLogger.info(`Worker created and listening for jobs on queue "${queueName}"`, {
        event: "worker_listening",
    });

    return worker;
}
