import type { JobsOptions } from "bullmq";

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 10_000,
    },
    removeOnComplete: {
        age: 24 * 3600,
        count: 1000,
    },
    removeOnFail: {
        age: 7 * 24 * 3600,
    },
};

export function blockProverJobId(height: number): string {
    return `bp:${height}`;
}

export function aggregatorJobId(height: number, index: number): string {
    return `agg:${height}:${index}`;
}

export function settlerJobId(height: number): string {
    return `settle:${height}`;
}
