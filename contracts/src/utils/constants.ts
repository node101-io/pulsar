export {
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

const VALIDATOR_NUMBER = 60;
const AGGREGATE_THRESHOLD = 32;
const LIST_LENGTH = AGGREGATE_THRESHOLD;
const TOTAL_GENERATORS = LIST_LENGTH - 1;
const MINIMUM_DEPOSIT_AMOUNT = 1e9;
const WITHDRAW_DOWN_PAYMENT = 1e9;
const BATCH_SIZE = 80;
const MAX_SETTLEMENT_PER_BATCH = 1;
const MAX_DEPOSIT_PER_BATCH = BATCH_SIZE;
const MAX_WITHDRAWAL_PER_BATCH = 9;
const ACTION_QUEUE_SIZE = 4000;
const ENDPOINTS = {
  NODE: {
    devnet: 'https://api.minascan.io/node/devnet/v1/graphql',
    mainnet: 'https://api.minascan.io/node/mainnet/v1/graphql',
    lightnet: 'http://127.0.0.1:8080/graphql',
  },
  ARCHIVE: {
    devnet: 'https://api.minascan.io/archive/devnet/v1/graphql',
    mainnet: 'https://api.minascan.io/archive/mainnet/v1/graphql',
    lightnet: 'http://127.0.0.1:8282',
  },
  EXPLORER: {
    devnet: 'https://minascan.io/devnet/tx/',
    mainnet: 'https://minascan.io/mainnet/tx/',
    lightnet:
      'file:///Users/kadircan/.cache/zkapp-cli/lightnet/explorer/v0.2.2/index.html?target=block&numberOrHash=',
  },
};
