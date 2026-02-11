// Processors constants
export const WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const PROOF_EPOCH_SIZE = 16;
export const BLOCK_EPOCH_SIZE = 8;
export const WORKER_COUNT = 10;

// Pulsar client constants
export const POLL_INTERVAL_MS = 5_000;
export const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
export const MINA_KEYS_SERVICE_NAME = "interchain_security.minakeys.Query";
