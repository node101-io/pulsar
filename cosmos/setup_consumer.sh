#!/bin/bash
set -e

# --- CONFIGURATION ---
PROVIDER_BINARY="interchain-security-pd"
PROVIDER_HOME="$HOME/.$PROVIDER_BINARY"
ACCOUNT_NAME="alice"
CHAIN_ID="provider"
KEYRING_BACKEND="test"
PROPOSAL_JSON="proposal.json"
CONSUMER_BINARY="$HOME/go/bin/pulsard"                  # <-- Path to your consumer binary
CONSUMER_GENESIS="$HOME/.$(basename $CONSUMER_BINARY | sed 's/.$//')/config/genesis.json"     # <-- Put your actual consumer genesis file here


# --- GET CCV GENESIS STATE FROM PROVIDER AND PATCH CONSUMER GENESIS ---

echo "Fetching CCV consumer genesis state from provider chain..."

$PROVIDER_BINARY query provider consumer-genesis $CONSUMER_ID --output json > ccv_state.json

# Patch CCV state into consumer genesis (backup old first)
if [ ! -f "$CONSUMER_GENESIS" ]; then
  echo "ERROR: Consumer genesis file not found at $CONSUMER_GENESIS"
  exit 1
fi

cp "$CONSUMER_GENESIS" "${CONSUMER_GENESIS}.bak"

# JQ ile patchle
jq -s '.[0].app_state.ccvconsumer = .[1] | .[0]' "$CONSUMER_GENESIS" ccv_state.json > "${CONSUMER_GENESIS}.tmp" && mv "${CONSUMER_GENESIS}.tmp" "$CONSUMER_GENESIS"

echo "Consumer genesis file patched with latest CCV state!"