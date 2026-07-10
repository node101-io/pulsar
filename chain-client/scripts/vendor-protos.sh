#!/usr/bin/env bash
set -euo pipefail

# Re-vendor the .proto tree that the runtime transport (src/transport.ts) loads
# via @grpc/proto-loader. Output is committed under ./proto, so normal builds
# need neither the buf CLI nor the network — run this only when bumping the
# pinned chain commit below (keep it in sync with buf.gen.yaml's ref).
#
# Requires: buf CLI (pnpm exec buf ...), network access.

cd "$(dirname "$0")/.."

PULSAR_REPO="https://github.com/node101-io/pulsar-chain.git"
PULSAR_REF="01358b3efc841b4e6b9af4cdaee4cc68b6b6fbbf" # keep == buf.gen.yaml ref
PULSAR_BRANCH="refactored-signer"

rm -rf proto
mkdir -p proto

# 1) Upstream cosmos-sdk tendermint query service (GetLatestBlock,
#    GetValidatorSetByHeight, ...) + its transitive cometbft/well-known deps.
#    Exported first so pulsar-chain's pinned copies of shared well-known types
#    (amino, gogoproto, cosmos_proto, google/*) win on the overwrite below.
pnpm exec buf export buf.build/cosmos/cosmos-sdk \
    --path cosmos/base/tendermint/v1beta1/query.proto \
    -o proto

# 2) pulsar-chain's own protos (abci, keyregistry, votepersistence, ...).
pnpm exec buf export \
    "${PULSAR_REPO}#branch=${PULSAR_BRANCH},ref=${PULSAR_REF},depth=50" \
    -o proto

echo "Vendored $(find proto -name '*.proto' | wc -l | tr -d ' ') .proto files into ./proto"
