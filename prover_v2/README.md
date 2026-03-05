# Pulsar Prover v2

ZK proof pipeline that syncs Cosmos (Tendermint) blocks, generates settlement proofs using o1js, and submits them to a Mina smart contract.

## Architecture Overview

```
Cosmos Chain (gRPC)
       │
       ▼
   Sync Module ──► storeBlock() ──► storeBlockInBlockEpoch()
                                           │
                                   epoch full? ──yes──► BullMQ: block-prover
                                                              │
                                                              ▼
                                                      BlockProver Worker
                                                       (ZK leaf proof)
                                                              │
                                                     sibling ready? ──yes──► BullMQ: aggregator
                                                                                    │
                                                                                    ▼
                                                                            Aggregator Worker
                                                                          (merge proof pair)
                                                                                    │
                                                                           is root? ──yes──► BullMQ: settler
                                                                           no──► next aggregation        │
                                                                                                         ▼
                                                                                                  Settler Worker
                                                                                              (submit to Mina chain)
```

The pipeline is **event-driven**: each stage triggers the next upon completion. There are no polling loops.

## Core Concepts

### Block Epoch

A group of `BLOCK_EPOCH_SIZE` (8) consecutive blocks. When all 8 blocks are synced, a BlockProver job is enqueued.

```
BlockEpoch { height: 0,  blocks: [block0, block1, ..., block7] }
BlockEpoch { height: 8,  blocks: [block8, block9, ..., block15] }
```

### Proof Epoch & Binary Tree

A ProofEpoch holds `PROOF_EPOCH_LEAF_COUNT` (4) leaf proofs and their aggregated parents in a binary tree:

```
          [6]              ← root (settlement index)
         /    \
       [4]    [5]          ← aggregated proofs
      /  \   /  \
    [0] [1] [2] [3]       ← leaf proofs (from BlockProver)
```

`proofs[]` array size = `LEAF_COUNT * 2 - 1` = 7 slots.

When both siblings exist (e.g. [0] and [1]), an Aggregator job merges them into the parent ([4]). This continues up the tree until the root proof at index 6 is produced, which the Settler submits on-chain.

### Deterministic Job IDs

Every BullMQ job uses a deterministic ID:
- BlockProver: `bp:{height}`
- Aggregator: `agg:{height}:{index}`
- Settler: `settle:{height}`

This prevents duplicate jobs. If a server crashes and restarts, the recovery sweep can safely re-enqueue without creating duplicates.

## Pipeline Stages

### 1. Sync (`modules/pulsar/`)

Polls the Cosmos chain via gRPC for new blocks. For each block:

1. Fetches block header, validator set, and vote extensions
2. Computes validator list hash (Poseidon hash over Mina public keys)
3. Calls `storeBlock()` — upserts block into MongoDB
4. Calls `storeBlockInBlockEpoch()` — places block reference in its epoch slot
5. If the epoch is full (all 8 slots filled), enqueues a `block-prover` BullMQ job

**Key file:** `modules/pulsar/utils.ts` — `storePulsarBlock()`

### 2. BlockProver (`modules/processors/block-prover/`)

Generates a ZK leaf proof from 8 consecutive blocks.

1. **Idempotency check:** If `proofEpoch.proofs[leafIndex]` already exists, skip ZK computation
2. Fetches the 8 blocks from MongoDB
3. For each consecutive pair, creates a `PulsarBlock` and collects `SignaturePublicKeyList`
4. Calls `GenerateSettlementProof()` (o1js ZK circuit)
5. Stores proof JSON in MongoDB, updates ProofEpoch
6. Calls `tryEnqueueAggregation()` — checks if sibling leaf is ready

**Key file:** `modules/processors/block-prover/worker.ts`

### 3. Aggregator (`modules/processors/aggregator/`)

Merges two sibling proofs into their parent.

1. **Idempotency check:** If `proofEpoch.proofs[parentIndex]` already exists, skip
2. Fetches left and right proof JSON from MongoDB
3. Calls `MergeSettlementProofs()` (o1js recursive proof merge)
4. Stores merged proof, updates ProofEpoch
5. If parent is the root (settlement index) → triggers Settler
6. Otherwise → triggers next level of aggregation via `tryEnqueueAggregation()`

**Key file:** `modules/processors/aggregator/worker.ts`

### 4. Settler (`modules/processors/settler/`)

Submits the final root proof to the Mina blockchain.

1. **Idempotency check:** If `proofEpoch.settled === true`, skip
2. Fetches the settlement proof from MongoDB
3. Connects to Mina network, instantiates `SettlementContract`
4. Calls `contractInstance.settle(settlementProof)`
5. Marks `settled = true` in MongoDB

**Key file:** `modules/processors/settler/worker.ts`

## BullMQ Configuration

All queues share the same job options:

| Setting | Value | Purpose |
|---------|-------|---------|
| `attempts` | 3 | Max retries before moving to failed set |
| `backoff` | exponential, 10s base | 10s → 20s → 40s between retries |
| `removeOnComplete` | 24h / 1000 jobs | Auto-cleanup of completed jobs |
| `removeOnFail` | 7 days | Keep failed jobs for debugging |
| `lockDuration` | 5 minutes | Worker must heartbeat within this window |
| `stalledInterval` | 5 seconds | How often BullMQ checks for stalled jobs |
| `concurrency` | 1 per worker | Each worker processes one job at a time |

Worker counts: 10 block-prover, 10 aggregator, 2 settler.

### Crash Recovery

BullMQ handles most crash scenarios automatically:
- **Worker dies mid-job:** Lock expires after `lockDuration`, job is re-queued
- **Redis disconnects:** ioredis auto-reconnects
- **Job fails 3 times:** Moved to BullMQ's "failed" set, monitor alerts

For edge cases (crash between proof storage and job enqueue), there's a **startup recovery sweep** (`modules/processors/recovery.ts`) that runs on every boot:

1. Finds full BlockEpochs without corresponding leaf proofs → enqueues BlockProver
2. Finds ProofEpochs with sibling pairs but missing parent → enqueues Aggregator
3. Finds root proofs that aren't settled → enqueues Settler

Safe to run repeatedly thanks to deterministic job IDs.

## MongoDB Models

### Block
```
{ height, stateRoot, validators[], validatorListHash, voteExt[] }
```
Raw block data from the Cosmos chain.

### BlockEpoch
```
{ height, blocks[8] }
```
Groups 8 block references. `blocks[i]` is either a Block ObjectId or null.

### ProofEpoch
```
{ height, proofs[7], settled }
```
Binary tree of proofs. `settled` marks whether the root proof has been submitted on-chain.

### Proof
```
{ data }
```
Serialized ZK proof JSON.

## Monitor (`modules/monitor/`)

Polls BullMQ queue health every 30 seconds:
- Checks `getFailedCount()`, `getWaitingCount()`, `getActiveCount()` for each queue
- Logs warnings when failed jobs are detected

## Trigger Logic (`modules/processors/triggers.ts`)

Generic binary tree navigation used by both BlockProver and Aggregator:

```typescript
siblingIndex  = completedIndex % 2 === 0 ? completedIndex + 1 : completedIndex - 1
parentIndex   = PROOF_EPOCH_LEAF_COUNT + Math.floor(completedIndex / 2)
```

- `tryEnqueueAggregation(proofEpoch, completedIndex)` — checks sibling, enqueues merge
- `tryEnqueueSettlement(proofEpoch)` — enqueues settler if root proof exists and not yet settled

## Key Constants (`modules/utils/constants.ts`)

| Constant | Value | Description |
|----------|-------|-------------|
| `BLOCK_EPOCH_SIZE` | 8 | Blocks per epoch |
| `PROOF_EPOCH_LEAF_COUNT` | 4 | Leaf proofs per proof epoch |
| `PROOF_EPOCH_SETTLEMENT_INDEX` | 6 | Root proof slot in proofs[] |
| `WORKER_COUNT` | 10 | Workers per queue (except settler: 2) |
| `WORKER_TIMEOUT_MS` | 300,000 | 5 min lock duration |
| `STALLED_INTERVAL_MS` | 5,000 | Stalled check frequency |
| `POLL_INTERVAL_MS` | 5,000 | Cosmos chain polling interval |
| `MONITOR_INTERVAL_MS` | 30,000 | Queue health check interval |

## Project Structure

```
src/modules/
├── pulsar/               # Cosmos chain sync
│   ├── sync.ts           # Block polling loop
│   └── utils.ts          # gRPC helpers, storePulsarBlock()
├── processors/
│   ├── block-prover/
│   │   └── worker.ts     # ZK leaf proof generation
│   ├── aggregator/
│   │   └── worker.ts     # Recursive proof merging
│   ├── settler/
│   │   └── worker.ts     # On-chain settlement
│   ├── triggers.ts       # Event-driven stage transitions
│   ├── pipeline.ts       # PipelineManager, worker lifecycle
│   ├── recovery.ts       # Startup recovery sweep
│   └── utils/
│       ├── queue.ts      # BullMQ queue instances
│       ├── jobs.ts       # Job type definitions
│       └── jobOptions.ts # Shared job config, deterministic IDs
├── db/
│   ├── models/
│   │   ├── block/        # Block schema + utils
│   │   ├── blockEpoch/   # BlockEpoch schema + utils
│   │   ├── proofEpoch/   # ProofEpoch schema + utils
│   │   └── proof/        # Proof schema + utils
│   └── index.ts          # Re-exports
├── monitor/
│   └── monitor.ts        # BullMQ queue health monitoring
└── utils/
    ├── constants.ts
    ├── interfaces.ts
    └── functions.ts
```

## What Changed (Refactoring Summary)

### Problem

The previous architecture duplicated BullMQ's built-in capabilities in MongoDB:
- `status[]` arrays on BlockEpoch/ProofEpoch tracked "waiting"/"processing"/"done" — but BullMQ already manages job states
- `failCount` fields reimplemented retry logic — but BullMQ has `attempts` + `backoff`
- `timeoutAt` fields reimplemented timeout detection — but BullMQ has `lockDuration` + stalled detection
- Master classes polled MongoDB in `while(true)` loops looking for "waiting" records — creating unnecessary load and latency
- If a server crashed while a record was in "processing" status, it would stay stuck forever

### Solution

**MongoDB is now a pure data store.** All job orchestration is handled by BullMQ.

| Before | After |
|--------|-------|
| Master polling loops | Event-driven push (worker triggers next stage) |
| MongoDB `status[]` fields | BullMQ job states |
| MongoDB `failCount` | BullMQ `attempts` + exponential backoff |
| MongoDB `timeoutAt` | BullMQ `lockDuration` + stalled detection |
| Manual crash recovery (none) | Automatic re-queue + startup recovery sweep |
| 15 hardcoded aggregation patterns | Generic binary tree formula |
| Mongoose transactions in workers | Idempotent upserts |

### Deleted

- `processors/base/Master.ts` — Base polling class
- `processors/block-prover/master.ts` — BlockProver polling loop
- `processors/aggregator/master.ts` — Aggregator polling loop
- `processors/settler/master.ts` — Settler polling loop
- `processors/block-prover/utils.ts` — Status registration helpers
- `db/types.ts` — `BlockStatus`, `ProofStatus`, `ProofKind` enums

### Added

- `processors/triggers.ts` — Event-driven stage transitions
- `processors/pipeline.ts` — PipelineManager (worker lifecycle + graceful shutdown)
- `processors/recovery.ts` — Startup recovery sweep
- `processors/utils/jobOptions.ts` — Shared BullMQ config + deterministic job ID generators

### Simplified

- **BlockEpoch schema:** Removed `status[]`, `epochStatus`, `failCount`, `timeoutAt`
- **ProofEpoch schema:** Removed `status[]`, `kind`, `failCount`, `timeoutAt`; added `settled: boolean`
- **Block schema:** Removed `status`, `timeoutAt`
- **Monitor:** Now checks BullMQ queue health instead of MongoDB failCount

## Running Tests

```bash
npx vitest run
```

12 test files, 72 tests covering all workers, triggers, recovery, monitor, and database utilities.
