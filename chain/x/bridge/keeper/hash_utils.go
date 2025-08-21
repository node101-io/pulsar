package keeper

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

// UpdateHash updates a hash by combining it with an action
// Implementation: Hash(currentHash, action)
func (k Keeper) UpdateHash(currentHash string, action types.PulsarAction) string {
	// Serialize the action
	actionBytes := k.cdc.MustMarshal(&action)

	// Combine current hash with action bytes
	combined := currentHash + string(actionBytes)

	// Use SHA256 for hashing
	hasher := sha256.New()
	hasher.Write([]byte(combined))
	return hex.EncodeToString(hasher.Sum(nil))
}

// InitializeHash creates an initial hash for empty state
func (k Keeper) InitializeHash() string {
	hasher := sha256.New()
	hasher.Write([]byte("pulsar_genesis"))
	return hex.EncodeToString(hasher.Sum(nil))
}
