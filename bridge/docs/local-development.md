# Local Development Guide

End-to-end instructions for running the bridge node locally against a Mina devnet or lightnet deployment.

---

## Overview

The bridge node consists of two PM2 processes:

| Process             | Entry point                                    | What it does                                      |
| ------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `bridge-main`       | `dist/src/index.js`                            | Archive sync loop + startup procedures            |
| `bridge-tx-sender`  | `dist/src/workers/bridge-tx-sender/index.js`   | Sequential reduce TX pipeline (master + worker)   |

Both processes share the same MongoDB database and Redis instance.

---

## First-time Setup

### 1. Build contracts

The bridge imports from `contracts/build/src/`. Always build contracts before the bridge:

```bash
cd contracts
npm install
npm run build
```

### 2. Install bridge dependencies

```bash
cd bridge
npm install
```

### 3. Fix o1js deduplication

If you installed `o1js` both in `bridge/` and `contracts/`, two instances of o1js will end up in the same Node process, causing a "global context inconsistent state" crash during proving. Symlink contracts' o1js to the shared instance:

```bash
rm -rf ../contracts/node_modules/o1js
ln -s $(pwd)/node_modules/o1js ../contracts/node_modules/o1js
```

Re-run this after any `npm install` in either directory.

### 4. Configure environment

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

### 5. Start MongoDB and Redis

Make sure both services are running before starting the bridge.

---

## Deploying the Contract (First Time Only)

If you don't have a deployed `SettlementContract` yet:

```bash
cd contracts
MINA_PRIVATE_KEY=<your key> npx ts-node --esm src/scripts/deployAndSeed.ts
```

The script deploys the contract in two transactions (deploy → initialize), compiles all ZK programs, and dispatches some test deposit/withdrawal actions. Copy the printed contract address into your `.env`.

---

## Running

### Without PM2 (development)

Run each process in a separate terminal:

```bash
# Terminal 1 — sync loop
cd bridge && npm run start

# Terminal 2 — TX sender
cd bridge && node dist/src/workers/bridge-tx-sender/index.js
```

### With PM2

```bash
cd bridge
npm run build
pm2 start ecosystem.config.cjs
```

Common PM2 commands:

```bash
pm2 list                        # show all processes
pm2 logs                        # stream all logs
pm2 logs bridge-tx-sender       # logs for one process
pm2 restart bridge-main         # restart one process
pm2 stop all
pm2 delete all
```

After deploying new code:

```bash
npm run build
# Re-apply o1js symlink if you ran npm install:
rm -rf ../contracts/node_modules/o1js && ln -s $(pwd)/node_modules/o1js ../contracts/node_modules/o1js
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
| `HARD_FINALITY_BLOCKS`      | `32`            | Mina blocks to wait before processing a height                               |
| `POLL_INTERVAL_MS`          | `5000`          | Archive sync poll interval (ms)                                              |
| `MAX_RETRY`                 | `3`             | Max worker failures before a block is permanently marked failed              |
| `LOG_LEVEL`                 | `info`          | Winston log level                                                            |
| `NODE_ENV`                  | `production`    | Node environment                                                             |

---

## npm Scripts Reference

| Script             | Description                                  |
| ------------------ | -------------------------------------------- |
| `npm run build`    | Compile TypeScript to `dist/`                |
| `npm run start`    | Build and start the main process             |
| `npm run lint`     | Run ESLint                                   |
| `npm run clean`    | Remove `dist/` and `node_modules/`           |

---

## Full Reset

To wipe all bridge state and start from scratch:

```bash
# Drop the MongoDB database
mongosh --eval 'use pulsar-bridge; db.dropDatabase()'

# Clear Redis (if you want to remove queued jobs too)
redis-cli FLUSHDB
```

After a reset, restart both processes. The sync loop will begin from height 0 and re-fetch all actions from the Archive.

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
