# Local Development Guide

End-to-end instructions for running the prover against a **real pulsar-chain
testnet on your machine**. The local chain runs the exact signing code that
production runs, so hash/encoding/signature mismatches surface immediately —
there is no simulated chain to drift out of sync.

---

## Overview

You run two things side by side:

| Process | Where | What it does |
|---------|-------|--------------|
| **Local chain** | pulsar-chain repo | N validators producing real blocks + Mina-signed vote extensions |
| **Prover** | this repo | Ingests blocks over gRPC, generates settlement proofs |

---

## First-time Setup

### 1. Prerequisites

- Go ≥ 1.22 and Python 3 (chain build)
- MongoDB and Redis running locally
- Node.js ≥ 20

### 2. Build and initialize the local chain

In the **pulsar-chain** repo:

```bash
bash scripts/setup_local_testnet.sh 3
```

This builds `pulsard`, initializes 3 validator homes (`~/.pulsar-node1..3`),
registers each validator's Mina key in the keyregistry genesis, and wires the
nodes as peers.

> The validator count must equal the circuit's `VALIDATOR_NUMBER`
> (`contracts/src/utils/constants.ts`) — the settlement circuit sizes its
> signature list to it.

### 3. Start the validators

One terminal per node:

```bash
pulsard start --home ~/.pulsar-node1   # gRPC :9090, RPC :26657
pulsard start --home ~/.pulsar-node2   # gRPC :9091
pulsard start --home ~/.pulsar-node3   # gRPC :9092
```

Blocks and vote extensions start flowing within seconds. Sanity check:

```bash
grpcurl -plaintext -d '{"vote_extension_height":"5"}' localhost:9090 \
    pulsarchain.abci.Query/VoteExtBodyByHeight
```

### 4. Point the prover at the chain

In this repo's `.env`:

```bash
PULSAR_GRPC_ENDPOINT=127.0.0.1:9090
MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB=pulsar
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Then start the prover stack:

```bash
npm run start
```

---

## Restarting / Reset

- **Chain**: `pulsard start` resumes from its data dir. To wipe and restart
  from genesis, re-run `setup_local_testnet.sh` (it cleans the node homes).
- **Prover**: `npm run reset` drops the Mongo database. Do this whenever you
  restart the chain from genesis — stored blocks from the old chain no longer
  match the new one.

---

## Notes

- The chain must produce blocks *ahead* of what the prover ingests: block `H`
  is processed once height `H+3` exists (vote extensions for `H` are persisted
  at `H+3`).
- Very early heights can miss historical staking info; the prover falls back
  to the block header for those and logs a warning.
- For a one-shot ingest+prove smoke test without the full worker stack, see
  the scripts under `src/scripts/`.
