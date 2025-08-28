package keeper

import (
	"context"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/bridge/types"
)

// MinaPublicKeyToCosmosAddress converts a Mina public key to registered Cosmos address
func (k Keeper) MinaPublicKeyToCosmosAddress(minaPublicKey string) (sdk.AccAddress, error) {
	// Validate Mina public key format (basic validation)
	if len(minaPublicKey) == 0 {
		return nil, types.ErrInvalidPublicKey
	}

	// Get key store entry for this Mina public key
	keyStore, found := k.minakeysKeeper.GetKeyStore(context.Background(), minaPublicKey)
	if !found {
		return nil, types.ErrPublicKeyNotRegistered
	}

	// Return the registered creator address
	return sdk.AccAddressFromBech32(keyStore.Creator)
}

// IsMinaPublicKeyRegistered checks if a Mina public key is registered in minakeys module
func (k Keeper) IsMinaPublicKeyRegistered(minaPublicKey string) bool {
	// Basic validation
	if len(minaPublicKey) == 0 {
		return false
	}

	// Check if this Mina public key exists in minakeys module
	_, found := k.minakeysKeeper.GetKeyStore(context.Background(), minaPublicKey)
	return found
}

// ValidateMinaPublicKey validates the format of a Mina public key
func (k Keeper) ValidateMinaPublicKey(minaPublicKey string) error {
	if len(minaPublicKey) == 0 {
		return types.ErrInvalidPublicKey
	}

	// Basic format validation - Mina public keys typically start with B62
	// and are base58 encoded, but for now we'll do basic length check
	if len(minaPublicKey) < 10 {
		return types.ErrInvalidPublicKey
	}

	return nil
}

// GetCosmosAddressString converts Mina public key to cosmos address string
func (k Keeper) GetCosmosAddressString(minaPublicKey string) (string, error) {
	addr, err := k.MinaPublicKeyToCosmosAddress(minaPublicKey)
	if err != nil {
		return "", err
	}
	return addr.String(), nil
}
