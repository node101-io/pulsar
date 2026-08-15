# Running the Bridge

The bridge is a single Node process with two loops: the **pusher** (submits
`MsgPushNewActions` so the chain keeps scanning Mina) and the **reduce loop**
(proves and submits `reduce()` transactions on Mina). It holds no special
rights, since both roles are just fee payers, so the worst a broken bridge
can cause is stalled transfers.

::: warning One instance only
Run exactly one bridge per contract. The reduce worker is deliberately
sequential; a second instance would race it.
:::

## Prerequisites

- Node ≥ 20, pnpm, and ~8 GB of headroom for proving
- **MongoDB** (one small state document) and **Redis** (job queue)
- A **Pulsar gRPC** endpoint
- A funded **Mina** account for reduce fees, and a funded **Pulsar** account
  for push fees

## Setup

```bash
pnpm install                 # repo root
cd bridge
cp .env.example .env         # fill in, see below
pnpm run build
pm2 start ecosystem.config.cjs   # or: pnpm run start
```

The first start compiles six circuits into `bridge/cache/`, which is slow
once and fast afterwards. Deleting the cache directory is always safe.

## Environment

The essentials (the annotated `.env.example` covers the rest):

| Variable | Meaning |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `REDIS_HOST` / `REDIS_PORT` | Redis (note: host defaults to `redis`, not localhost) |
| `MINA_NETWORK` | `devnet`, `mainnet`, or `lightnet` |
| `CONTRACT_ADDRESS` | The deployed settlement contract |
| `MINA_PRIVATE_KEY` | Fee payer for reduce transactions |
| `PULSAR_GRPC_ENDPOINT` | The chain (`:443` endpoints get TLS automatically) |
| `PULSAR_RPC_ENDPOINT` | Tendermint RPC; enables the pusher |
| `PULSAR_PRIVATE_KEY_HEX` | Fee payer for pushes; enables the pusher |

The pusher runs only when **both** of its variables are set; setting exactly
one is a boot error. Leave `PULSAR_FEE_AMOUNT` and `PULSAR_GAS_LIMIT` at
their defaults unless you know why, because underpaying stalls pushes
silently.

## Health

**First command when anything looks wrong:**

```bash
pnpm run doctor
```

It is read-only and prints one verdict: the first broken link in the chain of
dependencies (contract → chain → approval walk → proof inputs → archive →
breaker/fees). That includes the exact recovery command when the circuit breaker
is engaged and a warning when the fee payer runs low.

Logs are JSON with an `event` field. The ones that matter:

| Event | Meaning |
| --- | --- |
| `push_new_actions_sent` | The healthy heartbeat of the pusher |
| `bridge_tx_transient_failure` | Expected backpressure, e.g. waiting for the next push; not a problem |
| `reduce_tx_done` | A reduce landed |
| `master_halted_failed_front` | **Page-worthy**: the same batch failed repeatedly; run doctor |
| `push_chain_invariant` | **Page-worthy**: the chain rejected a push for an invariant reason |

The failure model: transient errors retry without penalty; deterministic
failures strike a budget and halt the loop at the threshold. The halt is
re-evaluated every tick, so fixing the cause (or clearing the counter with
the command doctor prints) recovers without a restart.

## Crash recovery

Nothing to do. Every attempt re-reads the contract and the chain from
scratch; whatever landed on-chain moved the cursors, and the next attempt
starts from there. pm2's `autorestart` is the recovery mechanism.
