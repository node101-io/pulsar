import "dotenv/config";
import "../../common/httpDefaults.js";

import { initDb } from "../../db/connection.js";
import logger from "../../common/logger.js";
import { TRANSIENT_EXIT_CODE } from "../../config/constants.js";
import { ensureCompiled, worker } from "./worker.js";

/**
 * Entrypoint for ONE reduce job, run as a child process of the
 * BridgeTxSender master.
 *
 * Proving lives here and not in the bridge process because o1js's prover can
 * freeze the event loop from native code — no timer, watchdog, or timeout in
 * the same process can fire once that happens (it silenced the whole bridge,
 * pusher included, for 6+ hours on 2026-08-15). A frozen child is killable
 * and leaves the bridge's queue, pusher, and bookkeeping untouched; the next
 * attempt re-derives everything from the chain, which is the worker's normal
 * idempotency contract. As a side effect the prover's multi-GB heap dies
 * with the job instead of accumulating in a long-lived process.
 *
 * Exit codes: 0 success, TRANSIENT_EXIT_CODE transient failure (no strike),
 * anything else a real failure (books a strike in the parent).
 */
async function main() {
    const fromActionState = process.argv[2];
    if (!fromActionState) {
        throw new Error("usage: job-main.js <fromActionState>");
    }
    await initDb();
    await ensureCompiled();
    await worker({ fromActionState });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        logger.error("Reduce job child failed", {
            error,
            event: "reduce_job_child_failed",
        });
        process.exit(
            (error as { transient?: boolean } | undefined)?.transient
                ? TRANSIENT_EXIT_CODE
                : 1,
        );
    });
