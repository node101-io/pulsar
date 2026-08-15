import { fileURLToPath } from "url";
import { env } from "./env.js";

export const MASTER_SLEEP_INTERVAL_MS = 1_000;
// A job holds batch preparation, proving and up to 3 × 10-minute inclusion
// waits — the lock must outlive it, and a stalled job must FAIL
// (maxStalledCount 0 in the worker) rather than silently replay a tx send.
export const WORKER_TIMEOUT_MS = 45 * 60 * 1_000;
/** Exit code the reduce-job child uses to signal a transient (no-strike)
 * failure to the parent — see bridge-tx-sender/job-main.ts. */
export const TRANSIENT_EXIT_CODE = 42;
export const STALLED_INTERVAL_MS = 30_000;
export const MAX_FAIL_COUNT = env.MAX_RETRY;

// Compile cache constants
// Every program shares one directory on purpose: the SRS and Lagrange bases are
// program-independent, so they are generated once and reused.
export const CACHE_DIR = fileURLToPath(
    new URL("../../../cache", import.meta.url),
);
