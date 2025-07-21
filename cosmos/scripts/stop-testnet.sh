#!/bin/bash

# Stop testnet script
# Stops all running nodes
#
# Usage: ./stop-testnet.sh [NODE_COUNT]
# Example: ./stop-testnet.sh 6  # Stops 6-node testnet

set -e

BASE_DIR="./.testnet"

# Get node count from argument or default to 4
NODE_COUNT=${1:-4}

# Validate node count
if ! [[ "$NODE_COUNT" =~ ^[0-9]+$ ]] || [ "$NODE_COUNT" -lt 1 ] || [ "$NODE_COUNT" -gt 10 ]; then
    echo "Error: Node count must be a number between 1 and 10"
    echo "Usage: $0 [NODE_COUNT]"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to stop a node
stop_node() {
    local node_num=$1
    local node_dir="$BASE_DIR/node$node_num"
    local pid_file="$node_dir/node.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat $pid_file)
        if ps -p $pid > /dev/null 2>&1; then
            log "Stopping node$node_num (PID: $pid)..."
            kill $pid
            
            # Wait for process to stop
            local wait_count=0
            while ps -p $pid > /dev/null 2>&1 && [ $wait_count -lt 10 ]; do
                sleep 1
                wait_count=$((wait_count + 1))
            done
            
            # Force kill if still running
            if ps -p $pid > /dev/null 2>&1; then
                warn "Force killing node$node_num..."
                kill -9 $pid
                sleep 1
            fi
            
            if ! ps -p $pid > /dev/null 2>&1; then
                log "✅ Node$node_num stopped successfully"
                rm $pid_file
            else
                error "Failed to stop node$node_num"
            fi
        else
            warn "Node$node_num not running (stale PID file)"
            rm $pid_file
        fi
    else
        warn "Node$node_num PID file not found"
    fi
}

log "🛑 Stopping cosmos testnet with $NODE_COUNT nodes..."

# Check if testnet directory exists
if [ ! -d "$BASE_DIR" ]; then
    warn "Testnet directory not found: $BASE_DIR"
    exit 0
fi

# Stop all nodes
stopped_count=0
for ((i=1; i<=NODE_COUNT; i++)); do
    if [ -d "$BASE_DIR/node$i" ]; then
        stop_node $i
        stopped_count=$((stopped_count + 1))
    else
        warn "Node$i directory not found: $BASE_DIR/node$i"
    fi
done

log ""
if [ $stopped_count -gt 0 ]; then
    log "🎉 Successfully stopped $stopped_count nodes"
else
    warn "No running nodes found"
fi

log ""
log "🔧 Cleanup options:"
log "  Remove logs only: find $BASE_DIR -name '*.log' -delete"
log "  Remove testnet completely: rm -rf $BASE_DIR" 