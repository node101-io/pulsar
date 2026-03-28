export const MOCK_BLOCK_PRODUCE_INTERVAL_MS = Number(
    process.env.MOCK_BLOCK_PRODUCE_INTERVAL_MS ?? 3000,
);

export const MOCK_VALIDATOR_POOL_SIZE = Number(
    process.env.MOCK_VALIDATOR_POOL_SIZE ?? 15,
);

export const MOCK_ACTIVE_VALIDATOR_COUNT = Number(
    process.env.MOCK_ACTIVE_VALIDATOR_COUNT ?? 10,
);

export const MOCK_VALIDATORS_CHANGE_PER_BLOCK = Number(
    process.env.MOCK_VALIDATORS_CHANGE_PER_BLOCK ?? 2,
);

export const MOCK_GRPC_PORT = Number(process.env.MOCK_GRPC_PORT ?? 50052);

export const MOCK_START_HEIGHT = Number(process.env.MOCK_START_HEIGHT ?? 1);

// Stake simulation
// Initial stake assigned to each validator (nanomina, uniform [min, max])
export const MOCK_VALIDATOR_INITIAL_STAKE_MIN = Number(
    process.env.MOCK_VALIDATOR_INITIAL_STAKE_MIN ?? 1_000_000,
);
export const MOCK_VALIDATOR_INITIAL_STAKE_MAX = Number(
    process.env.MOCK_VALIDATOR_INITIAL_STAKE_MAX ?? 100_000_000,
);
// Max stake delta per block (uniform distribution in -max, +max)
export const MOCK_VALIDATOR_STAKE_CHANGE_MAX = Number(
    process.env.MOCK_VALIDATOR_STAKE_CHANGE_MAX ?? 5_000_000,
);
export const MOCK_VALIDATOR_STAKE_MIN = Number(
    process.env.MOCK_VALIDATOR_STAKE_MIN ?? 100_000,
);

// Probability from 0 to 1 that any single active validator exits per block
export const MOCK_VALIDATOR_EXIT_PROBABILITY = Number(
    process.env.MOCK_VALIDATOR_EXIT_PROBABILITY ?? 0.1,
);
