package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

// SetDepositAmountMap set a specific depositAmountMap in the store from its address
func (k Keeper) SetDepositAmountMap(ctx context.Context, depositAmountMap types.DepositAmountMap) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.DepositAmountMapKeyPrefix))
	b := k.cdc.MustMarshal(&depositAmountMap)
	store.Set(types.DepositAmountMapKey(
		depositAmountMap.Address,
	), b)
}

// GetDepositAmountMap returns a depositAmountMap from its address
func (k Keeper) GetDepositAmountMap(
	ctx context.Context,
	address string,
) (val types.DepositAmountMap, found bool) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.DepositAmountMapKeyPrefix))

	b := store.Get(types.DepositAmountMapKey(
		address,
	))
	if b == nil {
		return val, false
	}

	k.cdc.MustUnmarshal(b, &val)
	return val, true
}

// RemoveDepositAmountMap removes a depositAmountMap from the store
func (k Keeper) RemoveDepositAmountMap(
	ctx context.Context,
	address string,
) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.DepositAmountMapKeyPrefix))
	store.Delete(types.DepositAmountMapKey(
		address,
	))
}

// GetAllDepositAmountMap returns all depositAmountMap
func (k Keeper) GetAllDepositAmountMap(ctx context.Context) (list []types.DepositAmountMap) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.DepositAmountMapKeyPrefix))
	iterator := storetypes.KVStorePrefixIterator(store, []byte{})

	defer iterator.Close()

	for ; iterator.Valid(); iterator.Next() {
		var val types.DepositAmountMap
		k.cdc.MustUnmarshal(iterator.Value(), &val)
		list = append(list, val)
	}

	return
}

// IncrementAmount increments the deposit amount for a given address
// If the address doesn't exist, it creates a new entry with the given amount
// If the address exists, it adds the amount to the existing value
func (k Keeper) IncrementAmount(ctx context.Context, address string, amount uint64) {
	// Try to get existing deposit amount map
	depositAmountMap, found := k.GetDepositAmountMap(ctx, address)

	if !found {
		// If not found, create new entry with the amount
		depositAmountMap = types.DepositAmountMap{
			Address: address,
			Amount:  amount,
		}
	} else {
		// If found, add the amount to existing value
		depositAmountMap.Amount += amount
	}

	// Set the updated deposit amount map
	k.SetDepositAmountMap(ctx, depositAmountMap)
}
