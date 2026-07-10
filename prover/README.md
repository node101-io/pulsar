# Pulsar Prover

Off-chain proving service that bridges the Pulsar (Cosmos) chain with the Mina zero-knowledge proof chain. It continuously reads blocks from Pulsar, generates zk settlement proofs over batches, and submits them to Mina's SettlementContract.

---

## Documentation

| Document | Description |
| -------- | ----------- |
| **[docs/architecture.md](docs/architecture.md)** | Full system architecture — module descriptions, processor pipeline, data models, proof aggregation tree, state machines, failure handling, and developer notes |
| **[docs/local-development.md](docs/local-development.md)** | Local development guide — running a real local pulsar-chain testnet, pointing the prover at it, restarting and resetting safely |

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
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` — see [Environment Variables](#environment-variables) for details.

### 3. Seed the database

This must be done once before the first run. It writes the genesis blocks (height 0 and 1) and the initial block epoch into MongoDB.

```bash
pnpm run seed
```

### 4. Start the node

```bash
pnpm run start
```

This compiles TypeScript and starts all processors concurrently:

- **Pulsar Sync** — polls the Pulsar gRPC node for new blocks
- **Mina Sync** — polls the Mina contract for the latest settled height
- **Block Prover** — generates a zk proof over each 8-block epoch
- **Aggregator** — merges proofs up a binary tree
- **Settlement Prover** — wraps the root proof into a Mina transaction
- **Settler** — signs and broadcasts the settlement transaction to Mina

---

## Local Development (real chain)

Run a real pulsar-chain testnet locally instead of a mock — same signing code as
production, so hash/signature mismatches surface immediately:

```bash
# in the pulsar-chain repo
bash scripts/setup_local_testnet.sh 3        # build + init 3 validators
pulsard start --home ~/.pulsar-node1         # one terminal per node (1..3)
```

Then point the prover at it with `PULSAR_GRPC_ENDPOINT=127.0.0.1:9090` in `.env`.
The validator count must match the circuit's `VALIDATOR_NUMBER` (contracts).

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

## All Scripts

| Script               | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `pnpm run start`      | Build and start the main prover node                           |
| `pnpm run seed`       | Seed MongoDB with genesis blocks (run once before first start) |
| `pnpm run smoke`      | One-shot ingest + prove smoke test against the configured node |
| `pnpm run test`       | Run all tests once                                             |
| `pnpm run test:watch` | Run tests in watch mode                                        |
| `pnpm run build`      | Compile TypeScript to `dist/`                                  |
| `pnpm run clean`      | Remove `dist/`, `coverage/`, and `node_modules/`               |

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

## TODO

- **Block pruning never runs.** The `BLOCKS_TO_KEEP` cleanup in `src/db/models/Block.ts` is a `post("save")` hook, but blocks are written via `findOneAndUpdate` (`storeBlock`), which does not fire document `save` middleware — so old blocks are never deleted and the collection grows unbounded. Move the pruning into `storeBlock` (after the upsert) or register it as `post("findOneAndUpdate")` middleware.
- **Validator set is re-fetched on every block.** `getBlockData` calls `GetValidatorSetByHeight` plus one keyregistry `GetValidatorMinaPubKey` gRPC call *per validator* for every ingested block, although the set rarely changes. Cache the sorted validator list keyed by the vote-ext body's `nextValidatorSetHash` (same hash → reuse, skip all lookups).
- **Add eslint with `@typescript-eslint/no-explicit-any: error`** to keep the gRPC boundary typed (the few remaining `any`s are documented reflection-boundary casts).

## Proto Types

TypeScript types for the pulsar-chain gRPC messages live in the shared
**`pulsar-chain-client`** workspace package (`chain-client/`), together with
the reflection-based transport and wire-format parsers used by both the
prover and the bridge. Regenerate them there:

```bash
pnpm --filter pulsar-chain-client proto:gen
```

The generated output is committed, so builds never need the buf CLI or
network; `proto:gen` only runs when bumping the pinned chain commit (see
`chain-client/buf.gen.yaml`).
