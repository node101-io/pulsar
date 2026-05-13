export const HARD_FINALITY_BLOCKS = Number(process.env.HARD_FINALITY_BLOCKS ?? 32);
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);
export const MASTER_SLEEP_INTERVAL_MS = 1_000;
export const WORKER_TIMEOUT_MS = 5 * 60 * 1_000;
export const STALLED_INTERVAL_MS = 5_000;
export const MAX_FAIL_COUNT = Number(process.env.MAX_RETRY ?? 3);

export const PULSAR_BRIDGE_SERVICE_NAME = "interchain_security.bridge.Query";
export const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
