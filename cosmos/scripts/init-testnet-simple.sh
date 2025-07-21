#!/bin/bash

# Simplified testnet initialization script
# Creates all accounts on primary node to avoid genesis complexity

set -e

# Configuration
CHAIN_ID="pulsar-testnet-1"
BINARY="cosmosd"
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

log "🚀 Starting simplified testnet initialization..."
log "Chain ID: $CHAIN_ID"
log "Base directory: $BASE_DIR"
log "Node count: $NODE_COUNT"

# Clean up previous testnet
if [ -d "$BASE_DIR" ]; then
    warn "Removing existing testnet directory: $BASE_DIR"
    rm -rf $BASE_DIR
fi
mkdir -p $BASE_DIR

# Base ports
P2P_BASE_PORT=26656
RPC_BASE_PORT=26657
GRPC_BASE_PORT=9091
API_BASE_PORT=1317

# Initialize primary node
PRIMARY_NODE="$BASE_DIR/node1"
log "🔧 Initializing primary node..."
$BINARY init validator1 --chain-id $CHAIN_ID --home $PRIMARY_NODE

# Configure primary node ports
CONFIG_FILE="$PRIMARY_NODE/config/config.toml"
APP_CONFIG_FILE="$PRIMARY_NODE/config/app.toml"

sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26656\"/laddr = \"tcp:\/\/127.0.0.1:26656\"/g" $CONFIG_FILE
sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26657\"/laddr = \"tcp:\/\/127.0.0.1:26657\"/g" $CONFIG_FILE
sed -i "s/address = \"tcp:\/\/0.0.0.0:1317\"/address = \"tcp:\/\/0.0.0.0:1317\"/g" $APP_CONFIG_FILE
sed -i "s/address = \"localhost:9090\"/address = \"localhost:9091\"/g" $APP_CONFIG_FILE

# Configure primary node secondary key
SECONDARY_KEY=$(get_secondary_key 1)
cat >> $APP_CONFIG_FILE << EOF

[minakeys]
secondary_key_hex = "$SECONDARY_KEY"
EOF

log "✅ Primary node initialized"

# Create all validator keys on primary node
declare -a VALIDATOR_ADDRS
log "🔑 Creating validator keys..."

for ((i=1; i<=NODE_COUNT; i++)); do
    echo "y" | $BINARY keys add validator$i --keyring-backend test --home $PRIMARY_NODE
    VALIDATOR_ADDR=$($BINARY keys show validator$i -a --keyring-backend test --home $PRIMARY_NODE)
    VALIDATOR_ADDRS[$i]=$VALIDATOR_ADDR
    
    # Add genesis account
    $BINARY genesis add-genesis-account $VALIDATOR_ADDR 100000000$STAKE_DENOM,10000$TOKEN_DENOM --home $PRIMARY_NODE
    
    log "  ✅ Validator $i: $VALIDATOR_ADDR"
done

# Create gentx files
log "🏗️  Creating genesis transactions..."
for ((i=1; i<=NODE_COUNT; i++)); do
    $BINARY genesis gentx validator$i 50000000$STAKE_DENOM \
        --chain-id $CHAIN_ID \
        --keyring-backend test \
        --home $PRIMARY_NODE
    
    log "  ✅ Gentx created for validator$i"
done

# Collect gentx
$BINARY genesis collect-gentxs --home $PRIMARY_NODE

# Configure genesis
GENESIS_FILE="$PRIMARY_NODE/config/genesis.json"
jq '.consensus.params.abci.vote_extensions_enable_height = "1"' $GENESIS_FILE > temp.json && mv temp.json $GENESIS_FILE
jq '.consensus.params.block.time_iota_ms = "1000"' $GENESIS_FILE > temp.json && mv temp.json $GENESIS_FILE

log "✅ Genesis configured"

# Initialize other nodes
log "🔧 Initializing other nodes..."
declare -a NODE_IDS
declare -a CONSENSUS_ADDRS

# Get primary node info first
NODE_ID1=$($BINARY tendermint show-node-id --home $PRIMARY_NODE)
CONSENSUS_ADDR1=$($BINARY tendermint show-address --home $PRIMARY_NODE)
NODE_IDS[1]=$NODE_ID1
CONSENSUS_ADDRS[1]=$CONSENSUS_ADDR1

for ((i=2; i<=NODE_COUNT; i++)); do
    NODE_DIR="$BASE_DIR/node$i"
    MONIKER="validator$i"
    
    log "Setting up $MONIKER..."
    
    # Initialize node
    $BINARY init $MONIKER --chain-id $CHAIN_ID --home $NODE_DIR
    
    # Copy genesis from primary node
    cp $PRIMARY_NODE/config/genesis.json $NODE_DIR/config/genesis.json
    
    # Copy keyring from primary node  
    cp -r $PRIMARY_NODE/keyring-test $NODE_DIR/ 2>/dev/null || true
    
    # Configure ports
    P2P_PORT=$((P2P_BASE_PORT + i - 1))
    RPC_PORT=$((RPC_BASE_PORT + i - 1))
    GRPC_PORT=$((GRPC_BASE_PORT + i - 1))
    API_PORT=$((API_BASE_PORT + i - 1))
    PPROF_PORT=$((6060 + i - 1))
    
    CONFIG_FILE="$NODE_DIR/config/config.toml"
    APP_CONFIG_FILE="$NODE_DIR/config/app.toml"
    
    sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26656\"/laddr = \"tcp:\/\/127.0.0.1:$P2P_PORT\"/g" $CONFIG_FILE
    sed -i "s/laddr = \"tcp:\/\/127.0.0.1:26657\"/laddr = \"tcp:\/\/127.0.0.1:$RPC_PORT\"/g" $CONFIG_FILE
    sed -i "s/pprof_laddr = \"localhost:6060\"/pprof_laddr = \"localhost:$PPROF_PORT\"/g" $CONFIG_FILE
    sed -i "s/address = \"tcp:\/\/0.0.0.0:1317\"/address = \"tcp:\/\/0.0.0.0:$API_PORT\"/g" $APP_CONFIG_FILE
    sed -i "s/address = \"localhost:9090\"/address = \"localhost:$GRPC_PORT\"/g" $APP_CONFIG_FILE
    
    # Configure secondary key
    SECONDARY_KEY=$(get_secondary_key $i)
    cat >> $APP_CONFIG_FILE << EOF

[minakeys]
secondary_key_hex = "$SECONDARY_KEY"
EOF
    
    # Get node info
    NODE_ID=$($BINARY tendermint show-node-id --home $NODE_DIR)
    CONSENSUS_ADDR=$($BINARY tendermint show-address --home $NODE_DIR)
    NODE_IDS[$i]=$NODE_ID
    CONSENSUS_ADDRS[$i]=$CONSENSUS_ADDR
    
    log "  ✅ Node $i initialized"
done

# Configure peers
log "🔗 Configuring peers..."
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
done

# Add KeyStore entries to genesis
log "📋 Adding secondary key mappings..."
cat > /tmp/keystore_entries.json << EOF
[
EOF

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

# Update genesis on primary node
jq --argjson keystores "$(cat /tmp/keystore_entries.json)" '.app_state.minakeys.keyStoreList = $keystores' $PRIMARY_NODE/config/genesis.json > temp.json && mv temp.json $PRIMARY_NODE/config/genesis.json

# Copy updated genesis to all nodes
for ((i=2; i<=NODE_COUNT; i++)); do
    cp $PRIMARY_NODE/config/genesis.json $BASE_DIR/node$i/config/genesis.json
done

rm /tmp/keystore_entries.json

log "🎉 Testnet initialization completed successfully!"
log ""
log "📊 Network Summary:"
log "  Chain ID: $CHAIN_ID"
log "  Nodes: $NODE_COUNT"
log "  Validators: $NODE_COUNT"
log "  Vote Extensions: Enabled from height 1"
log ""
log "🚀 To start the testnet, run: ./scripts/start-testnet.sh $NODE_COUNT" 