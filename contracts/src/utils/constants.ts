export {
  SETTLEMENT_MATRIX_SIZE,
  VALIDATOR_NUMBER,
  AGGREGATE_THRESHOLD,
  TOTAL_GENERATORS,
  LIST_LENGTH,
  MINIMUM_DEPOSIT_AMOUNT,
  INT64_AMOUNT_UPPER_BOUND,
  WITHDRAW_DOWN_PAYMENT,
  BATCH_SIZE,
  MAX_SETTLEMENT_PER_BATCH,
  MAX_DEPOSIT_PER_BATCH,
  MAX_WITHDRAWAL_PER_BATCH,
  ACTION_QUEUE_SIZE,
  APPROVAL_TAIL_CHUNK,
  ENDPOINTS,
};

const SETTLEMENT_MATRIX_SIZE = 8;
const VALIDATOR_NUMBER = 3;
// Max number of blocks aggregated per settlement proof. Capped at 32 to prevent
// race conditions on Mina. Submitting too many blocks at once can cause
// competing transactions to collide onchain before finalization.
const AGGREGATE_THRESHOLD = 32;
const LIST_LENGTH = (2 * AGGREGATE_THRESHOLD) / SETTLEMENT_MATRIX_SIZE;
const TOTAL_GENERATORS = LIST_LENGTH - 1;
const MINIMUM_DEPOSIT_AMOUNT = 1e9;
// Action amounts cross the Mina/Cosmos boundary as signed int64 values.
// Keep the exclusive upper bound here so every dispatch path uses the same
// wire-domain invariant: 0 < amount < 2^63.
const INT64_AMOUNT_UPPER_BOUND = 2n ** 63n;
const WITHDRAW_DOWN_PAYMENT = 1e9;
// 30, not 60: keeps reduce (~14.4k rows) and the quorum program (~5.2k)
// comfortably inside one step-domain size class while the o1js wrap bug is
// worked around (2026-08-11 hunt). Throughput is unaffected in the limit:
// the tail absorbs whatever a batch leaves unconsumed.
const BATCH_SIZE = 30;
const MAX_SETTLEMENT_PER_BATCH = 1;
const MAX_DEPOSIT_PER_BATCH = BATCH_SIZE;
const MAX_WITHDRAWAL_PER_BATCH = 9;
const ACTION_QUEUE_SIZE = 60;
// v2 leaves absorbed per ApprovalTailProgram step. Each slot costs one
// hashWithPrefix fold plus a mux, so the chunk bounds base-case rows, not
// correctness — a longer tail just stacks recursion layers. Row counts are
// logged by approvalTail.test.ts; retune there if compile cost moves.
const APPROVAL_TAIL_CHUNK = 128;

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
    // Only used to print clickable links in test logs. The zkApp CLI writes its
    // lightnet explorer under the invoking user's home directory, so there is no
    // default that works for anyone else — set LIGHTNET_EXPLORER_URL if you want
    // the links.
    lightnet: envOrDefault('LIGHTNET_EXPLORER_URL', ''),
  },
};
