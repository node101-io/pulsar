package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
)

// SetKeyStore set a specific keyStore in the store from its index
func (k Keeper) SetKeyStore(ctx context.Context, keyStore types.KeyStore) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.KeyStoreKeyPrefix))
	b := k.cdc.MustMarshal(&keyStore)
	store.Set(types.KeyStoreKey(
		keyStore.CosmosPublicKey,
	), b)
	store.Set(types.KeyStoreKey(keyStore.Creator), b)
}

// GetKeyStore returns a keyStore from its index
func (k Keeper) GetKeyStore(
	ctx context.Context,
	index string,

) (val types.KeyStore, found bool) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.KeyStoreKeyPrefix))

	b := store.Get(types.KeyStoreKey(
		index,
	))
	if b == nil {
		return val, false
	}

	k.cdc.MustUnmarshal(b, &val)
	return val, true
}

// RemoveKeyStore removes a keyStore from the store
func (k Keeper) RemoveKeyStore(
	ctx context.Context,
	index string,

) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.KeyStoreKeyPrefix))
	store.Delete(types.KeyStoreKey(
		index,
	))
}

// GetAllKeyStore returns all keyStore
func (k Keeper) GetAllKeyStore(ctx context.Context) (list []types.KeyStore) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.KeyStoreKeyPrefix))
	iterator := storetypes.KVStorePrefixIterator(store, []byte{})

	defer iterator.Close()

	for ; iterator.Valid(); iterator.Next() {
		var val types.KeyStore
		k.cdc.MustUnmarshal(iterator.Value(), &val)
		list = append(list, val)
	}

	return
}
