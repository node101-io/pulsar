# Local Development Guide

End-to-end instructions for running the prover against a **real pulsar-chain
testnet on your machine**. The local chain runs the exact signing code that
production runs, so hash/encoding/signature mismatches surface immediately —
there is no simulated chain to drift out of sync.

---

## Overview

You run three things side by side:

| Process | Where | What it does |
|---------|-------|--------------|
| **Local chain** | pulsar-chain repo | N validators producing real blocks + Mina-signed vote extensions |
| **Mina lightnet** | Docker, via `zk` CLI | Local Mina network the SettlementContract is deployed to |
| **Prover** | this repo | Ingests blocks over gRPC, proves them, settles on Mina |

How far you need to go depends on what you are testing:

| Goal | What you need |
|------|---------------|
| Chain ingest + block proving | Local chain only — then `pnpm run smoke` |
| Full pipeline through settlement | Local chain **and** lightnet — then `pnpm run start` |

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

### 5. Seed and verify the chain half

```bash
pnpm run seed    # writes genesis block 0, reading validators from chain height 1
pnpm run smoke   # ingests one epoch and generates a SettlementProof
```

If `smoke` passes, chain → ingest → proving works. Everything below adds the
Mina half.

> **Do not run `smoke` on a database you intend to run the full stack on.**
> Smoke ingests a window near the chain tip, so the sync loop — which resumes
> from the highest stored block — leaves every height below that window empty.
> The first proof epoch can then never complete, and the settler moves on to a
> later epoch whose proof the contract must reject. Run `pnpm run reset &&
> pnpm run seed` before `pnpm run start`.

---

## Mina Side (settlement)

Only needed to run the full pipeline — the aggregator, settlement-prover and
settler all talk to Mina. `pnpm run smoke` does not.

### 1. Start lightnet

Run the image directly — this is the same container the zkApp CLI drives, minus
a CLI version that has to stay in step with it:

```bash
docker run -d --name mina-local-lightnet \
  -p 127.0.0.1:3085:3085 -p 127.0.0.1:8080:8080 -p 127.0.0.1:8181:8181 \
  -p 127.0.0.1:8282:8282 -p 127.0.0.1:5432:5432 \
  -e NETWORK_TYPE=single-node -e PROOF_LEVEL=none -e RUN_ARCHIVE_NODE=true \
  -e LOG_LEVEL=Info -e SLOT_TIME=20000 \
  o1labs/mina-local-network:compatible-latest-lightnet
```

| Port | Service |
|------|---------|
| 8080 | Node GraphQL — `LIGHTNET_NODE_URL` |
| 8181 | Accounts manager (funded test keys) |
| 8282 | Archive node — `LIGHTNET_ARCHIVE_URL` |

`PROOF_LEVEL=none` skips on-chain proof verification, which is what makes
settlement TXs land in seconds instead of minutes.

Wait for it to sync — first block takes a minute or two:

```bash
until curl -s -X POST -H "Content-Type: application/json" \
  -d '{"query":"{syncStatus}"}' http://127.0.0.1:8080/graphql | grep -q SYNCED
do sleep 10; done
```

Lightnet is ephemeral: `docker rm -f mina-local-lightnet` discards all state,
including any contract deployed to it. Reusing a stopped container resumes a
stale chain — start a fresh one instead.

### 2. Deploy the SettlementContract

`settle` requires the contract's `merkleListRoot`, `stateRoot` and `blockHeight`
to equal the settlement proof's `Initial*` values, so the contract is anchored to
the block the first proof starts from — `ANCHOR_BLOCK_HEIGHT`, the block just
below the first proving epoch. `pnpm run seed` writes that block, so seed first;
deploy reads all three fields from it and fails loudly if it is missing.

```bash
MINA_NETWORK=lightnet pnpm run deploy
```

It compiles all four ZK programs (several minutes), deploys and initializes in
one transaction, then prints:

```
CONTRACT_ADDRESS=B62...
CONTRACT_PRIVATE_KEY=EK...
```

Copy both into `.env`, along with a funded lightnet key:

```bash
MINA_NETWORK=lightnet
MINA_PRIVATE_KEY=<funded lightnet account key>
CONTRACT_ADDRESS=<printed above>
CONTRACT_PRIVATE_KEY=<printed above>
```

Funded lightnet keys come from its account manager — `zk lightnet explorer`
lists them.

> There is a second deploy path, `contracts/build/src/scripts/lightnet-setup.js`.
> It is **not** for this flow: it invents a throwaway validator key, deploys with
> that root, and writes `bridge/.env.lightnet` for the bridge's lightnet loop
> (see `bridge/docs/local-development.md`). Use `pnpm run deploy` whenever the
> prover must follow the real chain.

### 3. Start the full stack

```bash
pnpm run start
```

All six processors run concurrently. Watch for `epoch_proof_done`, then
`settler_epoch_done` — the epoch has been settled on Mina at that point.

---

## Restarting / Reset

- **Chain**: `pulsard start` resumes from its data dir. To wipe and restart
  from genesis, re-run `setup_local_testnet.sh` (it cleans the node homes).
- **Prover**: `pnpm run reset` drops the Mongo database. Do this whenever you
  restart the chain from genesis — stored blocks from the old chain no longer
  match the new one.
- **Lightnet**: `zk lightnet stop` discards the network. Restarting it means
  redeploying the contract and updating `CONTRACT_ADDRESS`.

Restarting the chain from genesis invalidates the deployed contract too: its
`merkleListRoot` was initialized from the old chain's block 0. Re-run
`pnpm run reset` → `pnpm run seed` → `pnpm run deploy` in that order.

---

## Notes

- The chain must produce blocks *ahead* of what the prover ingests: block `H`
  is processed once height `H+3` exists (vote extensions for `H` are persisted
  at `H+3`).
- Very early heights can miss historical staking info; the prover falls back
  to the block header for those and logs a warning.
- `pnpm run smoke` ingests one epoch window from the chain and generates a
  SettlementProof through the production ingest + proving paths (~15 s) —
  the fastest way to verify chain ↔ prover ↔ circuit compatibility. It never
  touches Mina, so it passes without lightnet running.
- The prover node must run the same chain build the protos were generated
  from (the `pulsar-chain/` submodule commit at the repo root). An older
  chain binary lacks `GetValidatorSetWithMinaKeys` and every ingest fails
  with NotFound.
