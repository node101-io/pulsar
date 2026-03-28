# Pulsar Prover

Off-chain proving service that bridges the Pulsar (Cosmos) chain with the Mina zero-knowledge proof chain. It continuously reads blocks from Pulsar, generates zk settlement proofs over batches, and submits them to Mina's SettlementContract.

---

## Documentation

| Document | Description |
| -------- | ----------- |
| **[docs/architecture.md](docs/architecture.md)** | Full system architecture — module descriptions, processor pipeline, data models, proof aggregation tree, state machines, failure handling, and developer notes |

---

## Prerequisites

The following external services must be running before starting the node:

| Service               | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| **MongoDB**           | Persistent state (blocks, epochs, proofs)            |
| **Redis**             | BullMQ job queue backing store                       |
| **Pulsar gRPC node**  | Source of block data from the Pulsar chain           |
| **Mina RPC endpoint** | For reading and submitting to the SettlementContract |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` — see [Environment Variables](#environment-variables) for details.

### 3. Seed the database

This must be done once before the first run. It writes the genesis blocks (height 0 and 1) and the initial block epoch into MongoDB.

```bash
npm run seed
```

### 4. Start the node

```bash
npm run start
```

This compiles TypeScript and starts all processors concurrently:

- **Pulsar Sync** — polls the Pulsar gRPC node for new blocks
- **Mina Sync** — polls the Mina contract for the latest settled height
- **Block Prover** — generates a zk proof over each 8-block epoch
- **Aggregator** — merges proofs up a binary tree
- **Settlement Prover** — wraps the root proof into a Mina transaction
- **Settler** — signs and broadcasts the settlement transaction to Mina

---

## Test Mode (Local Development)

Test mode uses a mock Cosmos chain instead of a real Pulsar node, and targets Mina lightnet.

### 1. Start the mock chain server

```bash
npm run start-mock
```

This starts a local gRPC server that produces fake Pulsar blocks at a configurable interval.

### 2. Start the prover in test mode

Set `TEST_MODE=true` in `.env`, then:

```bash
npm run start
```

The prover will connect to `MOCK_GRPC_ENDPOINT` (default `localhost:50052`) instead of a real Pulsar node.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values.

### Redis

| Variable         | Default     | Description                         |
| ---------------- | ----------- | ----------------------------------- |
| `REDIS_HOST`     | `localhost` | Redis hostname                      |
| `REDIS_PORT`     | `6379`      | Redis port                          |
| `REDIS_PASSWORD` | —           | Redis password (if auth is enabled) |

### MongoDB

Either set `MONGO_URI` directly, or set the individual fields to construct it.

| Variable         | Default  | Description                                  |
| ---------------- | -------- | -------------------------------------------- |
| `MONGO_URI`      | —        | Full MongoDB connection URI (takes priority) |
| `MONGO_DB`       | `pulsar` | Database name                                |
| `MONGO_USER`     | —        | MongoDB username                             |
| `MONGO_PASSWORD` | —        | MongoDB password                             |

### Pulsar Chain

| Variable                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `PULSAR_GRPC_ENDPOINT`   | gRPC endpoint of the Pulsar node (e.g. `localhost:9090`) |
| `PULSAR_RPC_ENDPOINT`    | RPC endpoint of the Pulsar node                          |
| `PULSAR_CHAIN_ID`        | Chain ID of the Pulsar network                           |
| `PULSAR_PRIVATE_KEY_HEX` | Hex-encoded private key for signing Pulsar transactions  |
| `PULSAR_FEE_AMOUNT`      | Fee amount for Pulsar transactions                       |
| `PULSAR_FEE_DENOM`       | Fee denomination (e.g. `upulsar`)                        |
| `PULSAR_GAS_LIMIT`       | Gas limit for Pulsar transactions                        |
| `MERKLE_WITNESS`         | Merkle witness for the Pulsar contract                   |

### Mina

| Variable               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `MINA_PRIVATE_KEY`     | Private key for signing Mina transactions      |
| `MINA_NETWORK`         | Network type (`lightnet` for local testing)    |
| `MINA_FEE`             | Fee for Mina transactions                      |
| `CONTRACT_PRIVATE_KEY` | Private key of the SettlementContract deployer |
| `CONTRACT_ADDRESS`     | Deployed SettlementContract address on Mina    |

### Test / Mock Mode

| Variable                           | Default           | Description                         |
| ---------------------------------- | ----------------- | ----------------------------------- |
| `TEST_MODE`                        | —                 | Set to `true` to use the mock chain |
| `MOCK_GRPC_ENDPOINT`               | `localhost:50052` | Mock server gRPC address            |
| `MOCK_BLOCK_PRODUCE_INTERVAL_MS`   | `3000`            | Block production interval (ms)      |
| `MOCK_VALIDATOR_POOL_SIZE`         | `15`              | Total validators in the mock pool   |
| `MOCK_ACTIVE_VALIDATOR_COUNT`      | `10`              | Active validators per block         |
| `MOCK_VALIDATORS_CHANGE_PER_BLOCK` | `2`               | Validators rotating each block      |
| `MOCK_GRPC_PORT`                   | `50052`           | Port for the mock gRPC server       |
| `MOCK_START_HEIGHT`                | `1`               | Starting block height for the mock  |

---

## All npm Scripts

| Script               | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `npm run start`      | Build and start the main prover node                           |
| `npm run seed`       | Seed MongoDB with genesis blocks (run once before first start) |
| `npm run start-mock` | Build and start the mock Cosmos chain server                   |
| `npm run test`       | Run all tests once                                             |
| `npm run test:watch` | Run tests in watch mode                                        |
| `npm run build`      | Compile TypeScript to `dist/`                                  |
| `npm run clean`      | Remove `dist/`, `coverage/`, and `node_modules/`               |

---

## How It Works

### Processing Pipeline

```
Pulsar Blocks
     │
     ▼
 Block (8 blocks)
     │
     ▼
 Block Prover  ──►  zk SettlementProof (leaf)
                          │
                          ▼
                     Aggregator  ──►  binary tree merge
                          │
                          ▼
                  Settlement Prover  ──►  tx.prove()
                          │
                          ▼
                       Settler  ──►  broadcast to Mina
```

Each processor follows a **Master/Worker** pattern backed by BullMQ:

- The **Master** polls MongoDB, atomically claims work, and enqueues jobs
- **Workers** consume jobs from Redis, perform computation, and write results back to MongoDB

### Key Constants

| Constant                 | Value  | Description                                    |
| ------------------------ | ------ | ---------------------------------------------- |
| `BLOCK_EPOCH_SIZE`       | 8      | Blocks per proving epoch                       |
| `PROOF_EPOCH_LEAF_COUNT` | 4      | Leaf count in the aggregation tree             |
| `WORKER_TIMEOUT_MS`      | 300000 | Job lock duration (5 min)                      |
| `MAX_FAIL_COUNT`         | 3      | Failure threshold before an epoch is abandoned |
| `POLL_INTERVAL_MS`       | 5000   | Pulsar sync poll interval                      |
