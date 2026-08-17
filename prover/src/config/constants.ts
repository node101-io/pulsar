import { fileURLToPath } from "url";

// Processors constants
export const MASTER_SLEEP_INTERVAL_MS = 1000; // 1 second
// BullMQ lock duration. Renewed from the master's event loop every
// lockDuration/2, which is only dependable because proving no longer runs on
// that loop (see workers/childProver.ts).
export const WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const STALLED_INTERVAL_MS = 5000; // 5 seconds
export const BLOCK_EPOCH_SIZE = 8;
export const PROOF_EPOCH_LEAF_COUNT = 4;
export const PROOF_EPOCH_SIZE = BLOCK_EPOCH_SIZE * PROOF_EPOCH_LEAF_COUNT; // 32 blocks per proof epoch
export const WORKER_COUNT = 10;

// Wall-clock budget for ONE proof in its child process before the parent
// SIGKILLs it (see workers/childProver.ts). A freeze-breaker, not a
// performance SLA: keep it generous enough that it can never fire on healthy
// work. Observed block proof ≈ 42s.
export const PROVE_TIMEOUT_MS = Number(
    process.env.PROVE_TIMEOUT_MS || 10 * 60 * 1000,
); // 10 minutes
if (!Number.isFinite(PROVE_TIMEOUT_MS) || PROVE_TIMEOUT_MS < 60_000)
    throw new Error(
        `PROVE_TIMEOUT_MS must be >= 60000, got "${process.env.PROVE_TIMEOUT_MS}"`,
    );

// How many block epochs may hold a 'processing' claim fleet-wide. Until the
// child-process split, this was capped at 1 by accident: proving froze the
// master's event loop, so the claim loop could not run ahead. With the loop
// free, handleTask would claim the entire `waiting` backlog within seconds —
// thousands of meaningless claims and one queued job per block. Set it to the
// number of block-prover instances, so each can keep one epoch in flight.
// `||`, not `??`: an empty string in .env means unset.
export const MAX_IN_FLIGHT_BLOCK_EPOCHS = Number(
    process.env.MAX_IN_FLIGHT_BLOCK_EPOCHS || 3,
);
if (
    !Number.isInteger(MAX_IN_FLIGHT_BLOCK_EPOCHS) ||
    MAX_IN_FLIGHT_BLOCK_EPOCHS < 1
)
    throw new Error(
        `MAX_IN_FLIGHT_BLOCK_EPOCHS must be an integer >= 1, got "${process.env.MAX_IN_FLIGHT_BLOCK_EPOCHS}"`,
    );
// Settlement proof index in ProofEpoch.proofs[]
export const PROOF_EPOCH_SETTLEMENT_INDEX = PROOF_EPOCH_LEAF_COUNT * 2 - 2;

// Pulsar client constants
export const POLL_INTERVAL_MS = 3_000;
// The height the first 8-block epoch starts at (default: 2, first epoch 2-9).
// Overridable per deployment because a long-running chain would otherwise be
// proven from genesis: anchoring near the current height skips the backlog.
// The value is FROZEN at seed/deploy time — the contract is initialized
// against the anchor block it implies — so set it in .env before `seed` and
// never change it without `reset` + a contract redeploy.
// `||`, not `??`: an empty string in .env means unset.
export const EPOCH_START_HEIGHT = Number(process.env.EPOCH_START_HEIGHT || 2);
// Frozen into the contract at seed/deploy — garbage here costs a redeploy,
// so fail at boot instead of seeding from NaN.
if (!Number.isInteger(EPOCH_START_HEIGHT) || EPOCH_START_HEIGHT < 2)
    throw new Error(
        `EPOCH_START_HEIGHT must be an integer >= 2, got "${process.env.EPOCH_START_HEIGHT}"`,
    );
// The block every proof chain starts from: createProof(EPOCH_START_HEIGHT)
// reads from EPOCH_START_HEIGHT - 1, so this block's stateRoot,
// validatorListHash and height are the SettlementContract's initial state.
export const ANCHOR_BLOCK_HEIGHT = EPOCH_START_HEIGHT - 1;
// The chain persists block H's vote extensions at H + this, so H is only
// queryable once the chain has produced that later block.
export const VOTE_EXT_PERSISTENCE_LAG = 3;

// Settler pipeline constants
// Max settle txs broadcast ahead of on-chain confirmation. Settles chain by
// nonce AND by state precondition, so several can land in one Mina block —
// but every tx behind a failed one burns its fee, which bounds the sane
// window. Keep well under Mina's per-account mempool limit (~10).
// `||`, not `??`: an empty string in .env means unset.
export const SETTLER_WINDOW = Number(process.env.SETTLER_WINDOW || 5);
if (!Number.isInteger(SETTLER_WINDOW) || SETTLER_WINDOW < 1 || SETTLER_WINDOW > 8)
    throw new Error(
        `SETTLER_WINDOW must be an integer in [1, 8], got "${process.env.SETTLER_WINDOW}"`,
    );
// How long the oldest unconfirmed sent tx may age before the settler checks
// its fate and, if it died, re-sends the pipeline from that point. Must
// comfortably exceed a slow Mina block gap or healthy pipelines get reset.
export const SETTLER_STALL_TIMEOUT_MS = Number(
    process.env.SETTLER_STALL_TIMEOUT_MS || 20 * 60 * 1000,
); // 20 minutes
if (!Number.isFinite(SETTLER_STALL_TIMEOUT_MS) || SETTLER_STALL_TIMEOUT_MS < 60_000)
    throw new Error(
        `SETTLER_STALL_TIMEOUT_MS must be >= 60000, got "${process.env.SETTLER_STALL_TIMEOUT_MS}"`,
    );

// Multi-instance claim recovery: a claim (processing / txProving /
// txSending) whose document has not been touched for this long has a dead
// owner — healthy workers refresh updatedAt well within it. Must exceed the
// longest single proving step with margin, or the sweep steals live work.
// Derived from PROVE_TIMEOUT_MS rather than guessed: nothing writes to the
// claimed document while its proof runs, and PROVE_TIMEOUT_MS is now a HARD
// upper bound on that silence (the child is killed at it), so twice that is
// provably clear of any healthy prove.
export const STALE_CLAIM_TIMEOUT_MS = 2 * PROVE_TIMEOUT_MS; // 20 minutes
export const STALE_SWEEP_INTERVAL_MS = 60_000; // 1 minute

// Monitor constants
export const MAX_FAIL_COUNT = 3;
export const MONITOR_INTERVAL_MS = 30_000; // 30 seconds

// Cleanup constants
export const PROOF_TTL_SECONDS = 100 * 24 * 60 * 60; // 100 days

// Compile cache constants
// Every program shares one directory on purpose: the SRS and Lagrange bases are
// program-independent, so they are generated once and reused. See the README's
// "Circuit Compile Cache" section.
export const CACHE_DIR = fileURLToPath(
    new URL("../../../cache", import.meta.url),
);
