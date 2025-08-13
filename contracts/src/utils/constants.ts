export {
  SETTLEMENT_MATRIX_SIZE,
  VALIDATOR_NUMBER,
  AGGREGATE_THRESHOLD,
  TOTAL_GENERATORS,
  LIST_LENGTH,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
  BATCH_SIZE,
  MAX_SETTLEMENT_PER_BATCH,
  MAX_DEPOSIT_PER_BATCH,
  MAX_WITHDRAWAL_PER_BATCH,
  ACTION_QUEUE_SIZE,
  ENDPOINTS,
};

const SETTLEMENT_MATRIX_SIZE = 8;
const VALIDATOR_NUMBER = 1;
const AGGREGATE_THRESHOLD = 32;
const LIST_LENGTH = (2 * AGGREGATE_THRESHOLD) / SETTLEMENT_MATRIX_SIZE;
const TOTAL_GENERATORS = LIST_LENGTH - 1;
const MINIMUM_DEPOSIT_AMOUNT = 1e9;
const WITHDRAW_DOWN_PAYMENT = 1e9;
const BATCH_SIZE = 60;
const MAX_SETTLEMENT_PER_BATCH = 1;
const MAX_DEPOSIT_PER_BATCH = BATCH_SIZE;
const MAX_WITHDRAWAL_PER_BATCH = 9;
const ACTION_QUEUE_SIZE = 3000;

function envOrDefault(key: string, fallback: string) {
  return typeof process !== 'undefined' &&
    process.env &&
    typeof process.env[key] === 'string' &&
    process.env[key] !== ''
    ? process.env[key]!
    : fallback;
}

const ENDPOINTS = {
  NODE: {
    devnet: 'https://api.minascan.io/node/devnet/v1/graphql',
    mainnet: 'https://api.minascan.io/node/mainnet/v1/graphql',
    lightnet: envOrDefault(
      'LIGHTNET_NODE_URL',
      process.env.DOCKER
        ? 'http://mina-local-lightnet:8080/graphql'
        : 'http://127.0.0.1:8080/graphql'
    ),
  },
  ARCHIVE: {
    devnet: 'https://api.minascan.io/archive/devnet/v1/graphql',
    mainnet: 'https://api.minascan.io/archive/mainnet/v1/graphql',
    lightnet: envOrDefault(
      'LIGHTNET_ARCHIVE_URL',
      process.env.DOCKER
        ? 'http://mina-local-lightnet:8282'
        : 'http://127.0.0.1:8282'
    ),
  },
  EXPLORER: {
    devnet: 'https://minascan.io/devnet/tx/',
    mainnet: 'https://minascan.io/mainnet/tx/',
    lightnet:
      process.env.LIGHTNET_EXPLORER_URL ||
      'file:///Users/kadircan/.cache/zkapp-cli/lightnet/explorer/v0.2.2/index.html?target=block&numberOrHash=',
  },
};
