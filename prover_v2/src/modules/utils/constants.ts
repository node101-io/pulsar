// Processors constants
export const WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const STALLED_INTERVAL_MS = 5000; // 5 seconds
export const BLOCK_EPOCH_SIZE = 8;
export const PROOF_EPOCH_LEAF_COUNT = 4;
export const WORKER_COUNT = 10;
// Settlement proof index in ProofEpoch.proofs[]
export const PROOF_EPOCH_SETTLEMENT_INDEX = PROOF_EPOCH_LEAF_COUNT * 2 - 2;

// Pulsar client constants
export const POLL_INTERVAL_MS = 5_000;
export const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
export const MINA_KEYS_SERVICE_NAME = "interchain_security.minakeys.Query";

// Monitor constants
export const MONITOR_INTERVAL_MS = 30_000; // 30 seconds

// Cleanup constants
export const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
