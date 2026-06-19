# Local Development Guide

End-to-end instructions for running the prover stack locally using the mock chain.

---

## Overview

In local development you run two processes side-by-side:

| Process | Command | What it does |
|---------|---------|--------------|
| **Mock chain** | `npm run start-mock` | gRPC server that produces fake Pulsar blocks with rotating validator sets |
| **Prover node** | `npm run start` | The full prover stack in `TEST_MODE`, consuming blocks from the mock chain |

Both processes persist their state to JSON files on disk so they survive restarts independently — you can stop and restart either one without wiping the other.

---

## First-time Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Fix o1js module deduplication

`pulsar-contracts` is a local package that ships its own `node_modules/o1js`. Running two instances of o1js in the same Node process causes a "global context inconsistent state" crash during proving. After installing, replace it with a symlink to the single shared instance:

```bash
rm -rf ../contracts/node_modules/o1js
ln -s $(pwd)/node_modules/o1js ../contracts/node_modules/o1js
```

This must be re-run after any `npm install` in either `prover_v2/` or `contracts/`.

### 3. Configure environment

```bash
cp .env.example .env
```

Set at minimum:

```env
TEST_MODE=true
MONGO_URI=mongodb://localhost:27017
MONGO_DB=pulsar
REDIS_HOST=localhost
REDIS_PORT=6379
```

The mock-specific variables all have sensible defaults and do not need to be set.

### 4. Start MongoDB and Redis

Make sure both are running locally before proceeding.

---

## Running

### Terminal 1 — Mock chain

```bash
npm run start-mock
```

The mock chain:
- Generates a fresh validator pool on first run and saves it to `mock-state.json`
- Produces a new block every `MOCK_BLOCK_PRODUCE_INTERVAL_MS` ms (default 3 s)
- Rotates validators randomly each block (Tendermint semantics: old set signs the new block)
- On restart, reads `mock-state.json` and continues from where it left off

### Terminal 2 — Prover node

```bash
npm run start
```

The prover:
- Reads `mock-sync-state.json` to find the last synced block height
- Syncs new blocks from the mock gRPC endpoint
- Processes epochs, generates ZK proofs, and attempts Mina settlement

---

## State Files

| File | Owner | Contents |
|------|-------|----------|
| `mock-state.json` | Mock chain | Validator pool, active set, pool cursor, latest height, recent blocks |
| `mock-sync-state.json` | Prover sync | Last synced height and validator list |

Both files are written atomically (write to `.tmp` then rename) so a crash mid-write never leaves a corrupt file.

---

## Restarting Safely

**Restart mock chain only** — the prover detects that `latestHeight` dropped and resets `mock-sync-state.json` back to `-1`, then re-syncs from block 0. MongoDB data is preserved; blocks are re-written via upsert.

**Restart prover only** — reads `mock-sync-state.json`, continues from last saved height. No data loss.

**Restart both** — if `mock-state.json` exists, the mock chain resumes its exact state (same validators, same height). The prover then picks up where it left off.

---

## Running with PM2

PM2 manages each process independently — you can monitor, restart, and inspect logs per process.

### Install PM2

```bash
npm install -g pm2
```

### Test mode (mock chain + prover)

```bash
npm run build
pm2 start ecosystem.test.config.cjs
```

### Production mode (real Pulsar node)

```bash
npm run build
pm2 start ecosystem.config.cjs
```

### Common PM2 commands

```bash
pm2 list                        # show all processes and their status
pm2 logs                        # stream logs from all processes
pm2 logs mock-chain             # logs for a specific process
pm2 restart pulsar-block-prover # restart one process
pm2 stop all                    # stop everything
pm2 delete all                  # remove all from PM2 registry
pm2 save                        # persist process list (survives server reboot)
pm2 startup                     # generate systemd/launchd startup script
```

### After deploying new code

```bash
npm run build
# If you ran npm install, re-apply the o1js symlink:
rm -rf ../contracts/node_modules/o1js && ln -s $(pwd)/node_modules/o1js ../contracts/node_modules/o1js
pm2 restart all
```

---

## Full Reset

To start completely from scratch — fresh validator pool, empty database, cleared sync state:

```bash
npm run reset
```

This deletes `mock-state.json`, `mock-sync-state.json` (and their `.tmp` siblings) and drops the MongoDB database specified in `MONGO_DB`.

After a reset, start the mock chain first, then the prover.

---

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run start` | Build and start the prover node |
| `npm run start-mock` | Build and start the mock chain server |
| `npm run reset` | Delete state files + drop MongoDB (full clean slate) |
| `npm run seed` | Seed MongoDB with genesis block (production use only — not needed in test mode) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run clean` | Remove `dist/`, `coverage/`, `node_modules/` |

---

## Tuning Mock Behaviour

All mock parameters can be set in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_BLOCK_PRODUCE_INTERVAL_MS` | `3000` | Block production interval (ms) |
| `MOCK_VALIDATOR_POOL_SIZE` | `15` | Total validators available in the pool |
| `MOCK_ACTIVE_VALIDATOR_COUNT` | `5` | Active validators per block (must match `VALIDATOR_NUMBER` in contracts) |
| `MOCK_VALIDATOR_EXIT_PROBABILITY` | `0.1` | Per-validator probability of rotation each block |
| `MOCK_GRPC_PORT` | `50052` | Mock gRPC server port |
| `MOCK_STATE_PATH` | `./mock-state.json` | Path to mock chain state file |
| `MOCK_SYNC_STATE_PATH` | `./mock-sync-state.json` | Path to prover sync state file |

> **Note:** Changing `MOCK_ACTIVE_VALIDATOR_COUNT` after a run has started requires a full reset, as the validator pool is fixed for the lifetime of a chain.
