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

export function createWorker<Data, Result>(params: CreateWorkerParams<Data, Result>) {
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
        maxJobsPerWorker
    });
    
    workerLogger.info(`Worker initialized for queue "${queueName}"`, {
        event: "worker_initialized"
    });

    const processor: Processor<Data, Result, string> = async (job: Job<Data, Result, string>) => {
        if (!globalThis.__contractsCompiled__) {
            setMinaNetwork(
                (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") ?? "devnet"
            );
            // await compileContracts(queueName as QueueName);
            await cacheCompile(queueName as QueueName);
        }
        globalThis.__contractsCompiled__ = true;

        try {
            const startTime = Date.now();
            workerLogger.jobStarted(job.id!, queueName, {
                jobsProcessed,
                maxJobsPerWorker,
                jobData: job.data
            });

            const res = await jobHandler(job);
            const duration = Date.now() - startTime;
            jobsProcessed++;
            
            workerLogger.jobCompleted(job.id!, queueName, duration, {
                jobsProcessed,
                maxJobsPerWorker
            });
            
            if (jobsProcessed >= maxJobsPerWorker) {
                workerLogger.info("Worker reached max jobs limit, restarting", {
                    event: "worker_restart",
                    jobsProcessed,
                    maxJobsPerWorker
                });
                jobsProcessed = 0;
                worker.close().then(() => {
                    workerLogger.info("Worker closed successfully", {
                        event: "worker_closed"
                    });
                    process.exit(0);
                });
            }
            return res;
        } catch (error) {
            workerLogger.jobFailed(job.id!, queueName, error as Error, {
                jobsProcessed,
                maxJobsPerWorker,
                jobData: job.data
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

    worker.on(
        "failed",
        (job, err) =>
            `[${queueName}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${
                err?.stack || err
            }`
    );

    return worker;
}
