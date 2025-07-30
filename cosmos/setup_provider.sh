#!/bin/bash
set -e

# --- CONFIGURATION ---
PROVIDER_BINARY="interchain-security-pd"
PROVIDER_HOME="$HOME/.$PROVIDER_BINARY"
ACCOUNT_NAME="alice"
CHAIN_ID="provider"
KEYRING_BACKEND="test"
PROPOSAL_JSON="proposal.json"
CONSUMER_BINARY="$HOME/go/bin/interchain-security-cd"                  # <-- Path to your consumer binary
CONSUMER_GENESIS="$HOME/.$(basename $CONSUMER_BINARY | sed 's/.$//')/config/genesis.json"     # <-- Put your actual consumer genesis file here

# --- RESET PROVIDER STATE ---
#echo "Resetting provider chain state..."
#$PROVIDER_BINARY comet unsafe-reset-all --home "$PROVIDER_HOME"

#echo "Provider state reset."

# --- START PROVIDER NODE (background) ---
#echo "Starting provider node..."
#$PROVIDER_BINARY start --home "$PROVIDER_HOME" > provider.log 2>&1 &
#PROVIDER_PID=$!
#echo "Provider started with PID $PROVIDER_PID"
#sleep 3

# --- DYNAMIC VALUES FOR PROPOSAL ---

# 1. Compute SHA256 hash of the consumer genesis file
if [ ! -f "$CONSUMER_GENESIS" ]; then
  echo "ERROR: Consumer genesis file ($CONSUMER_GENESIS) not found!"
  exit 1
fi
GENESIS_HASH=$(sha256sum "$CONSUMER_GENESIS" | awk '{print $1}')

# 2. Compute SHA256 hash of the consumer binary
if [ ! -f "$CONSUMER_BINARY" ]; then
  echo "ERROR: Consumer binary ($CONSUMER_BINARY) not found!"
  exit 1
fi
BINARY_HASH=$(sha256sum "$CONSUMER_BINARY" | awk '{print $1}')

# 3. Spawn time = now + 1 minute (ISO8601, UTC)
SPAWN_TIME=$(date -u -d "+1 minute" +"%Y-%m-%dT%H:%M:%SZ")

# --- BUILD PROPOSAL JSON ---
cat > $PROPOSAL_JSON <<EOF
{
  "messages": [
    {
      "@type": "/interchain_security.ccv.provider.v1.MsgConsumerAddition",
      "chain_id": "ccv-1",
      "initial_height": {
        "revision_number": "1",
        "revision_height": "1"
      },
      "genesis_hash": "$GENESIS_HASH",
      "binary_hash": "$BINARY_HASH",
      "spawn_time": "$SPAWN_TIME",
      "unbonding_period": "600s",
      "ccv_timeout_period": "1200s",
      "transfer_timeout_period": "1200s",
      "consumer_redistribution_fraction": "0.75",
      "blocks_per_distribution_transmission": "1000",
      "historical_entries": "1000",
      "distribution_transmission_channel": "channel-1",
      "top_N": 95,
      "validators_power_cap": 0,
      "validator_set_cap": 0,
      "allowlist": [],
      "denylist": [],
      "authority": "cosmos10d07y265gmmuvt4z0w9aw880jnsr700j6zn9kn"
    }
  ],
  "metadata": "ipfs://CID",
  "deposit": "10000001stake",
  "title": "Create a chain",
  "summary": "Gonna be a great chain",
  "expedited": false
}
EOF

echo "Proposal JSON prepared with dynamic genesis_hash, binary_hash, and spawn_time."

# --- SUBMIT PROPOSAL (wait until node is up!) ---
echo "Waiting for provider node RPC to be available..."
for i in {1..20}; do
  if curl -s http://localhost:26657/status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Submitting proposal..."
$PROVIDER_BINARY tx gov submit-proposal $PROPOSAL_JSON --from $ACCOUNT_NAME --chain-id $CHAIN_ID --keyring-backend $KEYRING_BACKEND --yes

# --- Wait for proposal to be included ---
sleep 15

# --- Get the last proposal's ID (always fetch latest) ---
PROPOSAL_ID=$($PROVIDER_BINARY query gov proposals --output json | jq -r '.proposals[-1].id')
echo "Found proposal ID: $PROPOSAL_ID"

echo "Waiting for proposal to reach voting period..."
while true; do
STATUS=$($PROVIDER_BINARY query gov proposal $PROPOSAL_ID --output json | jq -r '.proposal.status' | tr -d '\n')
  echo "Current proposal status: '$STATUS'"  # DEBUG: See actual value
  if [ "$STATUS" = 'PROPOSAL_STATUS_VOTING_PERIOD' ]; then
    echo "Proposal is now in voting period."
    break
  fi
  sleep 1
done


# --- Vote YES with the validator account ---
$PROVIDER_BINARY tx gov vote $PROPOSAL_ID yes --from $ACCOUNT_NAME --chain-id $CHAIN_ID --keyring-backend $KEYRING_BACKEND --yes

echo "Voted YES on proposal $PROPOSAL_ID."

echo "Waiting for proposal to PASS (status 3)..."
while true; do
  STATUS=$($PROVIDER_BINARY query gov proposal $PROPOSAL_ID --output json | jq -r '.proposal.status' | tr -d '\n')
  echo "Current proposal status: '$STATUS'"
  if [ "$STATUS" = 'PROPOSAL_STATUS_PASSED' ]; then
    echo "Proposal PASSED!"
    break
  elif [ "$STATUS" = "4" ]; then
    echo "ERROR: Proposal was rejected (status 4). Exiting."
    exit 1
  elif [ "$STATUS" = "5" ]; then
    echo "ERROR: Proposal failed (status 5). Exiting."
    exit 1
  fi
  sleep 1
done

echo "Waiting for consumer chain to be registered in provider chain..."

while true; do
  CONSUMER_ID=$($PROVIDER_BINARY query provider list-consumer-chains --output json | jq -r '.chains[0].chain_id // empty')
  if [ -n "$CONSUMER_ID" ]; then
    echo "Found consumer chain: $CONSUMER_ID"
    break
  fi
  sleep 1
done


# --- GET CCV GENESIS STATE FROM PROVIDER AND PATCH CONSUMER GENESIS ---

echo "Fetching CCV consumer genesis state from provider chain..."

$PROVIDER_BINARY q provider consumer-genesis ccv-1 --output json > ccv_state.json

# Patch CCV state into consumer genesis (backup old first)
if [ ! -f "$CONSUMER_GENESIS" ]; then
  echo "ERROR: Consumer genesis file not found at $CONSUMER_GENESIS"
  exit 1
fi

cp "$CONSUMER_GENESIS" "${CONSUMER_GENESIS}.bak"

# JQ ile patchle
jq -s '.[0].app_state.ccvconsumer = .[1] | .[0]' "$CONSUMER_GENESIS" ccv_state.json > "${CONSUMER_GENESIS}.tmp" && mv "${CONSUMER_GENESIS}.tmp" "$CONSUMER_GENESIS"

echo "Consumer genesis file patched with latest CCV state!"


echo "Script complete."
