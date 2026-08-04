# Local Development Guide

End-to-end instructions for running the bridge node locally against a Mina devnet or lightnet deployment.

---

## Overview

The bridge is a single process:

| Process  | Entry point         | What it does                                                    |
| -------- | ------------------- | --------------------------------------------------------------- |
| `bridge` | `dist/src/index.js` | Sequential reduce TX pipeline driven by the contract's on-chain action queue |

It needs MongoDB (a one-document `BridgeState` for failure bookkeeping) and
Redis (the BullMQ job queue). See [architecture.md](architecture.md) for how
work is derived from the chain.

---

## First-time Setup

### 1. Install dependencies (pnpm workspace)

The repo is a pnpm workspace; one install at the repo root covers contracts,
chain-client, prover and bridge. o1js resolves to a single store copy for all
of them, so the old "two o1js instances" crash (and its symlink workaround)
is gone by construction.

```bash
# at the repo root
pnpm install
```

### 2. Build

`pnpm run build` in bridge/ builds its workspace dependencies
(pulsar-contracts, pulsar-chain-client) first, then the bridge itself:

```bash
cd bridge
pnpm run build
```

### 3. Configure environment

```bash
cp .env.example .env
```

Minimum required variables:

```env
MONGO_URI=mongodb://localhost:27017
MONGO_DB=pulsar-bridge
REDIS_HOST=localhost
REDIS_PORT=6379

MINA_NETWORK=devnet
CONTRACT_ADDRESS=<deployed SettlementContract address>
MINA_PRIVATE_KEY=<base58 private key for the bridge signing account>

PULSAR_VALIDATOR_ENDPOINTS=http://localhost:6000,http://localhost:6001
```

See the full reference below for all variables.

### 4. Start MongoDB and Redis

Make sure both services are running before starting the bridge.

---

## Deploying the Contract (First Time Only)

If you don't have a deployed `SettlementContract` yet, pick the path that matches
what you are testing:

### Against lightnet (bridge development)

```bash
zk lightnet start
cd contracts && pnpm run build
node build/src/scripts/lightnet-setup.js
```

This acquires a funded account from the lightnet account manager, generates a
throwaway validator key, deploys the contract with the matching
`merkleListRoot`, dispatches test deposit/withdrawal actions so the archive has
data, and writes `contracts/.env.lightnet` — which is also what
`pnpm run test:e2e` consumes. Pass `--no-seed` to skip the test actions.

### Against a real Pulsar chain

The bridge must verify signatures against the chain's actual validator set, so
the contract has to be initialized from the chain's genesis validator root.
That deploy lives in the prover, which has the ingested block 0:

```bash
cd prover && pnpm run seed && pnpm run deploy
```

See [prover/docs/local-development.md](../../prover/docs/local-development.md).

Either way, copy the printed contract address into your `.env`.

---

## Running

### Without PM2 (development)

```bash
cd bridge && pnpm run start
```

### With PM2

```bash
cd bridge
pnpm run build
pm2 start ecosystem.config.cjs
```

Common PM2 commands:

```bash
pm2 list                        # show all processes
pm2 logs bridge                 # stream logs
pm2 restart bridge
pm2 stop all
pm2 delete all
```

After deploying new code:

```bash
pnpm run build
pm2 restart all
```

---

## Environment Variables

| Variable                    | Default         | Description                                                                  |
| --------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `MONGO_URI`                 | —               | MongoDB connection string                                                    |
| `MONGO_DB`                  | `pulsar-bridge` | MongoDB database name                                                        |
| `REDIS_HOST`                | `redis`         | Redis host                                                                   |
| `REDIS_PORT`                | `6379`          | Redis port                                                                   |
| `REDIS_PASSWORD`            | —               | Redis password (optional)                                                    |
| `MINA_NETWORK`              | `lightnet`      | `lightnet` \| `devnet` \| `mainnet`                                          |
| `CONTRACT_ADDRESS`          | —               | Deployed `SettlementContract` address (base58)                               |
| `MINA_PRIVATE_KEY`          | —               | Signing key for the bridge account that sends reduce TXs (base58)            |
| `MINA_FEE`                  | `100000000`     | Transaction fee in nanomina (0.1 MINA)                                       |
| `PULSAR_VALIDATOR_ENDPOINTS`| —               | Comma-separated list of Pulsar signer-node base URLs (e.g. `http://v1:6000`) |
| `PULSAR_GRPC_ENDPOINT`      | —               | Pulsar chain gRPC endpoint (validator set + powers)                          |
| `MAX_RETRY`                 | `3`             | Non-transient strikes per queue front before the master halts                |
| `LOG_LEVEL`                 | `info`          | Winston log level                                                            |
| `NODE_ENV`                  | `production`    | Node environment                                                             |

---

## Scripts Reference

| Script             | Description                                  |
| ------------------ | -------------------------------------------- |
| `pnpm run build`    | Compile TypeScript to `dist/`                |
| `pnpm run start`    | Build and start the bridge                   |
| `pnpm run lint`     | Run ESLint                                   |
| `pnpm run clean`    | Remove `dist/` and `node_modules/`           |

---

## Full Reset

To wipe all bridge state and start from scratch:

```bash
# Drop the MongoDB database (failure bookkeeping only)
mongosh --eval 'use pulsar-bridge; db.dropDatabase()'

# Clear Redis (if you want to remove queued jobs too)
redis-cli FLUSHDB
```

After a reset, restart the bridge. Nothing else needs rebuilding — the work
list is always re-derived from the contract's on-chain action queue.

---

## Checking Contract State

You can query the deployed contract's state directly via GraphQL. The Archive endpoint for devnet is `https://api.minascan.io/archive/devnet/v1/graphql`.

To see recent actions dispatched to the contract:

```graphql
{
  zkapps(
    query: {
      zkappCommand: {
        accountUpdates: { body: { publicKey: "<CONTRACT_ADDRESS>" } }
      }
      canonical: true
    }
    sortBy: BLOCKHEIGHT_DESC
    limit: 10
  ) {
    blockHeight
    zkappCommand {
      accountUpdates {
        body {
          publicKey
          actions
        }
      }
    }
  }
}
```

To check on-chain state (provedState, account balance, etc.) use the Minascan explorer at `https://minascan.io/devnet/account/<CONTRACT_ADDRESS>`.
