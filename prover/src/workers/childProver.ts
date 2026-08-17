import { spawn } from "node:child_process";

import { PROVE_TIMEOUT_MS } from "../config/constants.js";
import logger from "../common/logger.js";

/**
 * Proving runs in a child process, never on a master's event loop.
 *
 * o1js can freeze the event loop from native code, and a frozen loop runs no
 * timers — so no watchdog, no BullMQ lock renewal and no stale-claim sweep in
 * the same process can ever fire once it happens. On 2026-08-16 that froze all
 * three block-provers mid-proof (every thread parked in
 * `memory.atomic.wait32`, whose wait has no timeout) and stopped settlement for
 * 35 hours while pm2 reported them `online` at 0% CPU. The same failure had
 * already silenced the bridge for 6+ hours on 2026-08-15, which is where this
 * pattern comes from.
 *
 * The rule the whole design rests on: a master process must not be able to
 * load o1js at all. Each prover therefore splits three ways — worker.ts (the
 * master's bookkeeping), proving.ts (the o1js work) and prove-main.ts (the
 * child entrypoint) — and only the last two ever touch o1js.
 *
 * One proving child at a time per process. o1js keeps a single global proving
 * context, which is why the in-process version had to serialize; with a child
 * per proof that constraint is gone, but the CPU one is not — a proof already
 * saturates the cores this process is entitled to. Every pm2 instance runs one
 * master, so this queue is the per-instance limit; the fleet-wide limit is
 * MAX_IN_FLIGHT_BLOCK_EPOCHS.
 */
let provingQueue: Promise<void> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        provingQueue = provingQueue.then(() => fn().then(resolve, reject));
    });
}

/**
 * Run one proof in a child process, rejecting if it fails or freezes.
 *
 * SIGKILL after PROVE_TIMEOUT_MS is what ends a freeze. The kill surfaces as a
 * normal job failure, so a prover that freezes deterministically on one input
 * trips MAX_FAIL_COUNT and surfaces rather than retrying forever.
 *
 * @param entry absolute path to the child's compiled entrypoint
 * @param args  argv passed to it, all of it operator-readable in `ps`
 */
export function runProvingJobInChild(
    entry: string,
    args: string[],
    context: Record<string, unknown>,
): Promise<void> {
    return serialize(
        () =>
            new Promise<void>((resolve, reject) => {
                // execArgv forwards pm2's --max-old-space-size to the child,
                // which is where the multi-GB proving heap now lives — and
                // dies, instead of accumulating in a long-lived process.
                const child = spawn(
                    process.execPath,
                    [...process.execArgv, entry, ...args],
                    { stdio: "inherit" },
                );

                let killedByTimeout = false;
                const killer = setTimeout(() => {
                    killedByTimeout = true;
                    logger.error(
                        `Proving child exceeded ${PROVE_TIMEOUT_MS}ms — killing it`,
                        { ...context, event: "proving_child_timeout" },
                    );
                    child.kill("SIGKILL");
                }, PROVE_TIMEOUT_MS);

                child.once("error", (error) => {
                    clearTimeout(killer);
                    reject(error);
                });

                child.once("exit", (code, signal) => {
                    clearTimeout(killer);
                    if (code === 0) return resolve();
                    reject(
                        new Error(
                            killedByTimeout
                                ? `proving child killed after ${PROVE_TIMEOUT_MS}ms (${JSON.stringify(context)}) — prover froze`
                                : `proving child exited with code ${code}, signal ${signal} (${JSON.stringify(context)})`,
                        ),
                    );
                });
            }),
    );
}

/**
 * Child-side counterpart: run one unit of proving work and exit 0 on success,
 * 1 on failure — the only thing runProvingJobInChild reads.
 *
 * process.exit, not a natural return: o1js leaves worker threads and native
 * handles behind that would keep the child alive after its work is done.
 */
export function runAsProvingChild(
    label: string,
    main: () => Promise<void>,
): void {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            logger.error(`${label} proving child failed`, {
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                event: "proving_child_failed",
            });
            process.exit(1);
        });
}
