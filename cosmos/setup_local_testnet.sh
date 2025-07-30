#!/bin/bash
set -e

# Binaries for provider and consumer chains
PROVIDER_BINARY="interchain-security-pd"
CONSUMER_BINARY="pulsard"
# Chain parameters
PROVIDER_CHAIN_ID="provider"
CONSUMER_CHAIN_ID="ccv-1"
PROVIDER_MONIKER="provider-node"
CONSUMER_MONIKER="pulsar-node"

# Token denominations and amounts
DENOM_STAKE="stake"
DENOM_TOKEN="token"
ACCOUNT_NAME="alice"
KEYFILE="./alice.keyfile"
ACCOUNT_STAKE_AMOUNT="1000000000000"
ACCOUNT_TOKEN_AMOUNT="1000000000000"
ACCOUNT_SELF_BOND="824645461121"
KEYRING_BACKEND="test"

# Dynamic home directories from binary names
PROVIDER_HOME="$HOME/.$(basename $PROVIDER_BINARY | sed 's/.$//')"
CONSUMER_HOME="$HOME/.$(basename $CONSUMER_BINARY | sed 's/.$//')"

echo "Do you want to delete all old provider and consumer chain data in:"
echo "  $PROVIDER_HOME"
echo "  $CONSUMER_HOME"
read -p "Type y to continue, anything else to cancel and exit: " confirm

if [ "$confirm" = "y" ]; then
  echo "Cleaning up old chain data..."
  rm -rf "$PROVIDER_HOME"
  rm -rf "$CONSUMER_HOME"
  echo "Old chain data removed."
else
  echo "Aborting setup as requested. No changes were made."
  exit 1
fi

echo "1. Initializing provider chain..."
$PROVIDER_BINARY init $PROVIDER_MONIKER --chain-id $PROVIDER_CHAIN_ID --home "$PROVIDER_HOME"

echo "2. Initializing consumer chain..."
$CONSUMER_BINARY init $CONSUMER_MONIKER --chain-id $CONSUMER_CHAIN_ID --home "$CONSUMER_HOME"

echo "3. Importing account key into provider..."
$PROVIDER_BINARY keys import $ACCOUNT_NAME $KEYFILE --keyring-backend $KEYRING_BACKEND --home "$PROVIDER_HOME"

echo "4. Importing account key into consumer..."
$CONSUMER_BINARY keys import $ACCOUNT_NAME $KEYFILE --keyring-backend $KEYRING_BACKEND --home "$CONSUMER_HOME"

ACCOUNT_ADDRESS=$($PROVIDER_BINARY keys show $ACCOUNT_NAME -a --keyring-backend $KEYRING_BACKEND --home "$PROVIDER_HOME")
echo "Account address: $ACCOUNT_ADDRESS"

echo "5. Adding genesis account with both tokens (stake & token) on provider..."
$PROVIDER_BINARY genesis add-genesis-account $ACCOUNT_NAME ${ACCOUNT_STAKE_AMOUNT}${DENOM_STAKE},${ACCOUNT_TOKEN_AMOUNT}${DENOM_TOKEN} --keyring-backend $KEYRING_BACKEND --home "$PROVIDER_HOME"

echo "6. Creating genesis validator transaction (gentx) for the account..."
$PROVIDER_BINARY genesis gentx $ACCOUNT_NAME ${ACCOUNT_SELF_BOND}${DENOM_STAKE} --chain-id $PROVIDER_CHAIN_ID --keyring-backend $KEYRING_BACKEND --home "$PROVIDER_HOME"

echo "7. Collecting gentxs..."
$PROVIDER_BINARY genesis collect-gentxs --home "$PROVIDER_HOME"

echo "8. Validating genesis file..."
$PROVIDER_BINARY genesis validate-genesis --home "$PROVIDER_HOME"

# Path to the genesis.json for the provider
PROVIDER_GENESIS="$PROVIDER_HOME/config/genesis.json"

if [ ! -f "$PROVIDER_GENESIS" ]; then
  echo "ERROR: $PROVIDER_GENESIS not found. Did you run 'init' first?"
  exit 1
fi

echo "Patching provider genesis.json: shortening voting and deposit periods for rapid local testing..."
jq '
  .app_state.gov.params.max_deposit_period = "30s" |
  .app_state.gov.params.voting_period = "30s" |
  .app_state.gov.params.expedited_voting_period = "15s"
' "$PROVIDER_GENESIS" > "$PROVIDER_GENESIS.tmp" && mv "$PROVIDER_GENESIS.tmp" "$PROVIDER_GENESIS"
echo "Governance timing parameters patched!"

echo "Copying provider's priv_validator_key.json and node_key.json to consumer chain..."
cp "$PROVIDER_HOME/config/priv_validator_key.json" "$CONSUMER_HOME/config/priv_validator_key.json"
cp "$PROVIDER_HOME/config/node_key.json" "$CONSUMER_HOME/config/node_key.json"
echo "Key files copied!"

echo "Setup complete! Both provider and consumer chains are initialized, and the account is ready."
