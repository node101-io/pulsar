#!/usr/bin/env bash
set -euo pipefail

# Re-vendor the .proto tree that buf.gen.yaml generates the typed clients and
# codecs from (ts-proto, outputServices=grpc-js). The protos are generation
# input only — nothing reads them at runtime. Run this only when bumping the
# pinned chain commit below, then `pnpm run proto:gen`.
#
# Requires: buf CLI (pnpm exec buf ...), network access.

cd "$(dirname "$0")/.."

PULSAR_REPO="https://github.com/node101-io/pulsar-chain.git"
PULSAR_REF="b5362a24c78efebec86cc12307ac48f13c643af2"
PULSAR_BRANCH="development"

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
