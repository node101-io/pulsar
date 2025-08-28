package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/node101-io/pulsar/chain/x/minakeys/types"
)

// SetVoteExt set a specific voteExt in the store from its index
func (k Keeper) SetVoteExt(ctx context.Context, voteExt types.VoteExt) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtKeyPrefix))
	b := k.cdc.MustMarshal(&voteExt)
	store.Set(types.VoteExtKey(
		voteExt.Index,
	), b)
}

// GetVoteExt returns a voteExt from its index
func (k Keeper) GetVoteExt(
	ctx context.Context,
	index string,

) (val types.VoteExt, found bool) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtKeyPrefix))

	b := store.Get(types.VoteExtKey(
		index,
	))
	if b == nil {
		return val, false
	}

	k.cdc.MustUnmarshal(b, &val)
	return val, true
}

// RemoveVoteExt removes a voteExt from the store
func (k Keeper) RemoveVoteExt(
	ctx context.Context,
	index string,

) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtKeyPrefix))
	store.Delete(types.VoteExtKey(
		index,
	))
}

// GetAllVoteExt returns all voteExt
func (k Keeper) GetAllVoteExt(ctx context.Context) (list []types.VoteExt) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtKeyPrefix))
	iterator := storetypes.KVStorePrefixIterator(store, []byte{})

	defer iterator.Close()

	for ; iterator.Valid(); iterator.Next() {
		var val types.VoteExt
		k.cdc.MustUnmarshal(iterator.Value(), &val)
		list = append(list, val)
	}

	return
}

// SetVoteExtIndex sets or updates the index mapping for a given height
func (k Keeper) SetVoteExtIndex(ctx context.Context, height uint64, voteExtIndex string) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtIndexKeyPrefix))

	// Get existing index or create new one
	voteExtIndexObj := k.GetVoteExtIndex(ctx, height)

	// Add new index to the array if not already present
	for _, existingIndex := range voteExtIndexObj.Indexes {
		if existingIndex == voteExtIndex {
			return // Already exists
		}
	}

	voteExtIndexObj.Height = height
	voteExtIndexObj.Indexes = append(voteExtIndexObj.Indexes, voteExtIndex)

	b := k.cdc.MustMarshal(&voteExtIndexObj)
	store.Set(types.VoteExtIndexKey(height), b)
}

// GetVoteExtIndex returns the index mapping for a given height
func (k Keeper) GetVoteExtIndex(ctx context.Context, height uint64) types.VoteExtIndex {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtIndexKeyPrefix))

	b := store.Get(types.VoteExtIndexKey(height))
	if b == nil {
		return types.VoteExtIndex{Height: height, Indexes: []string{}}
	}

	var val types.VoteExtIndex
	k.cdc.MustUnmarshal(b, &val)
	return val
}

// GetVoteExtsByHeight returns all VoteExt for a given height using index mapping
func (k Keeper) GetVoteExtsByHeight(ctx context.Context, height uint64) (list []types.VoteExt) {
	indexMapping := k.GetVoteExtIndex(ctx, height)

	for _, index := range indexMapping.Indexes {
		voteExt, found := k.GetVoteExt(ctx, index)
		if found {
			list = append(list, voteExt)
		}
	}

	return list
}

// RemoveVoteExtIndex removes the index mapping for a given height
func (k Keeper) RemoveVoteExtIndex(ctx context.Context, height uint64) {
	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.VoteExtIndexKeyPrefix))
	store.Delete(types.VoteExtIndexKey(height))
}
