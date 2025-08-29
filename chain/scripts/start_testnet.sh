#!/bin/bash

# Testnet startup script
# Starts all nodes of the cosmos testnet
#
# Usage: ./start-testnet.sh [NODE_COUNT]
# Example: ./start-testnet.sh 6  # Starts 6-node testnet

set -e

# Configuration
BINARY="interchain-security-cd"
BASE_DIR="./.testnet"

# Get node count from argument or default to 4
NODE_COUNT=${1:-4}

# Validate node count
if ! [[ "$NODE_COUNT" =~ ^[0-9]+$ ]] || [ "$NODE_COUNT" -lt 1 ] || [ "$NODE_COUNT" -gt 10 ]; then
    echo "Error: Node count must be a number between 1 and 10"
    echo "Usage: $0 [NODE_COUNT]"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check if testnet directory exists
if [ ! -d "$BASE_DIR" ]; then
    error "Testnet directory not found. Please run ./scripts/init-testnet.sh first."
fi

# Check if binary exists
if ! command -v $BINARY &> /dev/null; then
    error "$BINARY binary not found. Please make sure it's installed and in PATH."
fi

log "🚀 Starting cosmos testnet with $NODE_COUNT nodes..."

# Base ports
P2P_BASE_PORT=26656
RPC_BASE_PORT=26657
GRPC_BASE_PORT=9091  # Changed from 9090 to 9091
API_BASE_PORT=1317

# Function to start a single node
start_node() {
    local node_num=$1
    local node_dir="$BASE_DIR/node$node_num"
    
    if [ ! -d "$node_dir" ]; then
        error "Node$node_num directory not found: $node_dir"
    fi
    
    local pid_file="$node_dir/node.pid"
    local log_file="$node_dir/node.log"
    
    # Check if node is already running
    if [ -f "$pid_file" ]; then
        local existing_pid=$(cat $pid_file)
        if ps -p $existing_pid > /dev/null 2>&1; then
            warn "Node$node_num is already running (PID: $existing_pid)"
            return 0
        else
            # Remove stale PID file
            rm $pid_file
        fi
    fi
    
    log "Starting node$node_num..."
    
    # Start the node in background and save PID
    nohup $BINARY start --home $node_dir --minimum-gas-prices="0stake" > $log_file 2>&1 &
    local pid=$!
    echo $pid > $pid_file
    
    # Wait a bit and check if process is still running
    sleep 2
    if ps -p $pid > /dev/null 2>&1; then
        log "✅ Node$node_num started successfully (PID: $pid)"
        
        # Show port information
        local p2p_port=$((P2P_BASE_PORT + node_num - 1))
        local rpc_port=$((RPC_BASE_PORT + node_num - 1))
        local grpc_port=$((GRPC_BASE_PORT + node_num - 1))
        local api_port=$((API_BASE_PORT + node_num - 1))
        
        log "   P2P: 127.0.0.1:$p2p_port | RPC: 127.0.0.1:$rpc_port | gRPC: 127.0.0.1:$grpc_port | API: 127.0.0.1:$api_port"
        log "   Logs: $log_file"
        return 0
    else
        error "Failed to start node$node_num. Check logs: $log_file"
        return 1
    fi
}

# Start all nodes
log "📦 Starting $NODE_COUNT nodes..."
for ((i=1; i<=NODE_COUNT; i++)); do
    start_node $i
done

log ""
log "🎉 All nodes started successfully!"
log ""
log "📊 Network Status:"
log "  Testnet: $NODE_COUNT nodes running"
log "  Base directory: $BASE_DIR"
log ""
log "🔍 Useful commands:"
log "  Check status: curl -s http://127.0.0.1:26657/status"
log "  View logs: tail -f $BASE_DIR/node1/node.log"
log "  Stop testnet: ./scripts/stop-testnet.sh $NODE_COUNT"
log ""
log "📱 Node Endpoints:"
for ((i=1; i<=NODE_COUNT; i++)); do
    local rpc_port=$((RPC_BASE_PORT + i - 1))
    local grpc_port=$((GRPC_BASE_PORT + i - 1))
    local api_port=$((API_BASE_PORT + i - 1))
    
    log "  Node$i - RPC: http://127.0.0.1:$rpc_port, gRPC: 127.0.0.1:$grpc_port, API: http://127.0.0.1:$api_port"
done

log ""
log "🚀 Testnet is now running! Use Ctrl+C to return to terminal (nodes will continue running in background)" 