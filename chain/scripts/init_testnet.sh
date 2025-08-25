#!/bin/bash

# Comprehensive testnet initialization script for cosmos blockchain
# This script sets up a multi-node testnet with proper validator configuration,
# secondary key mapping, and vote extensions enabled.
#
# Usage: ./init-testnet.sh [NODE_COUNT]
# Example: ./init-testnet.sh 6  # Creates 6-node testnet

set -e

# Configuration
CHAIN_ID="pulsar-testnet-1"
BINARY="interchain-security-cd"
BASE_DIR="./.testnet"
MONIKER_PREFIX="validator"
STAKE_DENOM="stake"
TOKEN_DENOM="token"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Get node count from argument or default to 4
NODE_COUNT=${1:-4}

# Validate node count
if ! [[ "$NODE_COUNT" =~ ^[0-9]+$ ]] || [ "$NODE_COUNT" -lt 1 ] || [ "$NODE_COUNT" -gt 10 ]; then
    echo "Error: Node count must be a number between 1 and 10"
    echo "Usage: $0 [NODE_COUNT]"
    exit 1
fi

# Check if secondary keys file exists
KEYS_FILE="scripts/secondary_keys.json"
if [ ! -f "$KEYS_FILE" ]; then
    error "Secondary keys file not found: $KEYS_FILE"
fi

# Check if we have enough keys
AVAILABLE_KEYS=$(jq 'length' "$KEYS_FILE")
if [ "$NODE_COUNT" -gt "$AVAILABLE_KEYS" ]; then
    error "Not enough secondary keys! Requested: $NODE_COUNT, Available: $AVAILABLE_KEYS. Please add more keys to $KEYS_FILE"
fi

# Check if binary exists
if ! command -v $BINARY &> /dev/null; then
    error "$BINARY binary not found. Please make sure it's installed and in PATH."
fi

log "🚀 Starting testnet initialization..."
log "Chain ID: $CHAIN_ID"
log "Base directory: $BASE_DIR"
log "Node count: $NODE_COUNT"

# Clean up previous testnet
if [ -d "$BASE_DIR" ]; then
    warn "Removing existing testnet directory: $BASE_DIR"
    rm -rf $BASE_DIR
fi
mkdir -p $BASE_DIR

# Function to get secondary key from JSON file
get_secondary_key() {
    local index=$1
    jq -r ".[$((index-1))].secondary_key" "$KEYS_FILE"
}

# Function to get Mina address from JSON file
get_mina_address() {
    local index=$1
    jq -r ".[$((index-1))].mina_address" "$KEYS_FILE"
}

# Base ports (each node will use sequential ports)
P2P_BASE_PORT=26656
RPC_BASE_PORT=26657
GRPC_BASE_PORT=9091  # Changed from 9090 to 9091
API_BASE_PORT=1317

# Arrays to store validator info
declare -a VALIDATOR_ADDRS
declare -a CONSENSUS_ADDRS
declare -a GENTX_FILES

log "🔧 Initializing $NODE_COUNT nodes..."

# Initialize each node
for ((i=1; i<=NODE_COUNT; i++)); do
    NODE_DIR="$BASE_DIR/node$i"
    MONIKER="$MONIKER_PREFIX$i"
    
    log "Setting up $MONIKER in $NODE_DIR"
    
    # Initialize node
    $BINARY init $MONIKER --chain-id $CHAIN_ID --home $NODE_DIR
    
    # Calculate ports for this node
    P2P_PORT=$((P2P_BASE_PORT + i - 1))
    RPC_PORT=$((RPC_BASE_PORT + i - 1))
    GRPC_PORT=$((GRPC_BASE_PORT + i - 1))
    API_PORT=$((API_BASE_PORT + i - 1))
    PPROF_PORT=$((6060 + i - 1))
    
    log "  Ports - P2P: $P2P_PORT, RPC: $RPC_PORT, gRPC: $GRPC_PORT, API: $API_PORT"
    
    # Configure ports in config.toml
    CONFIG_FILE="$NODE_DIR/config/config.toml"
    sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26656\"/laddr = \"tcp:\/\/127.0.0.1:$P2P_PORT\"/g" $CONFIG_FILE
    sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26657\"/laddr = \"tcp:\/\/127.0.0.1:$RPC_PORT\"/g" $CONFIG_FILE
    sed -i "s/pprof_laddr = \"localhost:6060\"/pprof_laddr = \"localhost:$PPROF_PORT\"/g" $CONFIG_FILE
    
    # Enable CORS for RPC
    sed -i 's/cors_allowed_origins = \[\]/cors_allowed_origins = ["*"]/g' $CONFIG_FILE
    
    # Configure ports in app.toml
    APP_CONFIG_FILE="$NODE_DIR/config/app.toml"
    sed -i "s/address = \"tcp:\/\/0.0.0.0:1317\"/address = \"tcp:\/\/0.0.0.0:$API_PORT\"/g" $APP_CONFIG_FILE
    sed -i "s/address = \"localhost:9090\"/address = \"localhost:$GRPC_PORT\"/g" $APP_CONFIG_FILE
    sed -i "s/address = \"0.0.0.0:9091\"/address = \"0.0.0.0:$((GRPC_PORT + 100))\"/g" $APP_CONFIG_FILE
    
    # Get secondary key for this node from JSON file
    SECONDARY_KEY=$(get_secondary_key $i)
    
    # Configure secondary key in app.toml
    cat >> $APP_CONFIG_FILE << EOF

[minakeys]
secondary_key_hex = "$SECONDARY_KEY"
EOF
    
    log "  ✅ Secondary key configured for $MONIKER"
    
    # Add validator key
    echo "y" | $BINARY keys add validator$i --keyring-backend test --home $NODE_DIR
    
    # Get validator address
    VALIDATOR_ADDR=$($BINARY keys show validator$i -a --keyring-backend test --home $NODE_DIR)
    VALIDATOR_ADDRS[$i]=$VALIDATOR_ADDR
    
    log "  ✅ Validator address: $VALIDATOR_ADDR"
    
    # Add genesis account
    $BINARY genesis add-genesis-account $VALIDATOR_ADDR 100000000$STAKE_DENOM,10000$TOKEN_DENOM --home $NODE_DIR
    
    log "  ✅ Node $i initialized successfully"
done

log "🏗️  Creating genesis transactions..."

# Create gentx for each validator
for ((i=1; i<=NODE_COUNT; i++)); do
    NODE_DIR="$BASE_DIR/node$i"
    VALIDATOR_ADDR=${VALIDATOR_ADDRS[$i]}
    
    log "Creating gentx for validator$i"
    
    # Create gentx
    $BINARY genesis gentx validator$i 50000000$STAKE_DENOM \
        --chain-id $CHAIN_ID \
        --keyring-backend test \
        --home $NODE_DIR
    
    # Store gentx file path
    GENTX_FILES[$i]="$NODE_DIR/config/gentx/gentx-*.json"
    
    log "  ✅ Gentx created for validator$i"
done

log "🔄 Collecting genesis transactions..."

# Use node1 as the primary node to collect gentx files
PRIMARY_NODE="$BASE_DIR/node1"

# Copy all gentx files to primary node
for ((i=2; i<=NODE_COUNT; i++)); do
    cp $BASE_DIR/node$i/config/gentx/*.json $PRIMARY_NODE/config/gentx/
done

# Collect gentx
$BINARY genesis collect-gentxs --home $PRIMARY_NODE

log "⚙️  Configuring genesis and consensus parameters..."

# Update genesis.json with required parameters
GENESIS_FILE="$PRIMARY_NODE/config/genesis.json"

# Enable vote extensions from height 1
jq '.consensus.params.abci.vote_extensions_enable_height = "1"' $GENESIS_FILE > temp.json && mv temp.json $GENESIS_FILE

# Set shorter block times for testing
jq '.consensus.params.block.time_iota_ms = "1000"' $GENESIS_FILE > temp.json && mv temp.json $GENESIS_FILE

log "  ✅ Vote extensions enabled from height 1"

# Get consensus addresses for mapping
log "🔑 Extracting consensus addresses for secondary key mapping..."

for ((i=1; i<=NODE_COUNT; i++)); do
    NODE_DIR="$BASE_DIR/node$i"
    
    # Get consensus address
    CONSENSUS_ADDR=$($BINARY tendermint show-address --home $NODE_DIR)
    CONSENSUS_ADDRS[$i]=$CONSENSUS_ADDR
    
    log "  Validator$i consensus address: $CONSENSUS_ADDR"
done

log "📋 Adding secondary key mappings to genesis..."

# Create temporary file for keystore entries
cat > /tmp/keystore_entries.json << EOF
[
EOF

# Add KeyStore entries - mapping consensus addresses to Mina addresses
for ((i=1; i<=NODE_COUNT; i++)); do
    CONSENSUS_ADDR=${CONSENSUS_ADDRS[$i]}
    MINA_ADDR=$(get_mina_address $i)
    VALIDATOR_ADDR=${VALIDATOR_ADDRS[$i]}
    
    if [ $i -gt 1 ]; then
        echo "," >> /tmp/keystore_entries.json
    fi
    
    cat >> /tmp/keystore_entries.json << EOF
  {
    "cosmosPublicKey": "$CONSENSUS_ADDR",
    "minaPublicKey": "$MINA_ADDR",
    "creator": "$VALIDATOR_ADDR"
  }
EOF
done

echo "]" >> /tmp/keystore_entries.json

# Add keystore entries to genesis
jq --argjson keystores "$(cat /tmp/keystore_entries.json)" '.app_state.minakeys.keyStoreList = $keystores' $GENESIS_FILE > temp.json && mv temp.json $GENESIS_FILE

rm /tmp/keystore_entries.json

log "  ✅ Secondary key mappings added to genesis"

# Copy the final genesis to all nodes
log "📄 Distributing genesis file to all nodes..."
for ((i=2; i<=NODE_COUNT; i++)); do
    cp $PRIMARY_NODE/config/genesis.json $BASE_DIR/node$i/config/genesis.json
    log "  ✅ Genesis copied to node$i"
done

# Set up persistent peers
log "🔗 Configuring persistent peers..."

# Get node IDs
declare -a NODE_IDS
for ((i=1; i<=NODE_COUNT; i++)); do
    NODE_ID=$($BINARY tendermint show-node-id --home $BASE_DIR/node$i)
    NODE_IDS[$i]=$NODE_ID
    log "  Node$i ID: $NODE_ID"
done

# Configure peers for each node
for ((i=1; i<=NODE_COUNT; i++)); do
    PEERS=""
    for ((j=1; j<=NODE_COUNT; j++)); do
        if [ $i -ne $j ]; then
            PEER_PORT=$((P2P_BASE_PORT + j - 1))
            if [ -n "$PEERS" ]; then
                PEERS="${PEERS},"
            fi
            PEERS="${PEERS}${NODE_IDS[$j]}@127.0.0.1:$PEER_PORT"
        fi
    done
    
    CONFIG_FILE="$BASE_DIR/node$i/config/config.toml"
    sed -i "s/persistent_peers = \"\"/persistent_peers = \"$PEERS\"/g" $CONFIG_FILE
    
    log "  ✅ Peers configured for node$i"
done

log "🎉 Testnet initialization completed successfully!"
log ""
log "📊 Network Summary:"
log "  Chain ID: $CHAIN_ID"
log "  Nodes: $NODE_COUNT"
log "  Validators: $NODE_COUNT"
log "  Vote Extensions: Enabled from height 1"
log ""
log "🔧 Node Information:"
for ((i=1; i<=NODE_COUNT; i++)); do
    P2P_PORT=$((P2P_BASE_PORT + i - 1))
    RPC_PORT=$((RPC_BASE_PORT + i - 1))
    GRPC_PORT=$((GRPC_BASE_PORT + i - 1))
    API_PORT=$((API_BASE_PORT + i - 1))
    SECONDARY_KEY=$(get_secondary_key $i)
    MINA_ADDR=$(get_mina_address $i)
    
    log "  Node$i:"
    log "    Home: $BASE_DIR/node$i"
    log "    P2P: 127.0.0.1:$P2P_PORT"
    log "    RPC: 127.0.0.1:$RPC_PORT"
    log "    gRPC: 127.0.0.1:$GRPC_PORT"
    log "    API: 127.0.0.1:$API_PORT"
    log "    Validator: ${VALIDATOR_ADDRS[$i]}"
    log "    Consensus: ${CONSENSUS_ADDRS[$i]}"
    log "    Secondary Key: $SECONDARY_KEY"
    log "    Mina Address: $MINA_ADDR"
    log ""
done

log "🚀 To start the testnet, run: ./scripts/start-testnet.sh $NODE_COUNT" 