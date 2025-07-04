import { Worker, Job, Processor, WorkerOptions, AdvancedOptions } from "bullmq";
import { connection } from "../workerConnection.js";
import { compileContracts } from "../utils.js";
import logger from "../logger.js";
import { setMinaNetwork } from "pulsar-contracts";

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

    const processor: Processor<Data, Result, string> = async (job: Job<Data, Result, string>) => {
        if (!globalThis.__contractsCompiled__) {
            setMinaNetwork(
                (process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") ?? "devnet"
            );
            await compileContracts();
            globalThis.__contractsCompiled__ = true;
        }

        try {
            const res = await jobHandler(job);
            return res;
        } finally {
            jobsProcessed += 1;
            if (jobsProcessed >= maxJobsPerWorker) {
                logger.info(
                    `[${queueName}] reached ${jobsProcessed} jobs → exiting for fresh spawn`
                );
                setTimeout(() => process.exit(0), 200);
            }
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

    worker.on("failed", (job, err) =>
        logger.warn(`[${queueName}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err}`)
    );

    return worker;
}
