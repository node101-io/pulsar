package keeper

import (
	"encoding/binary"

	"cosmossdk.io/math"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

// GetWithdrawalBalance returns the withdrawal balance for a given public key
func (k Keeper) GetWithdrawalBalance(ctx sdk.Context, publicKey string) math.Int {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	key := append(types.WithdrawalBalancesKeyPrefix, []byte(publicKey)...)

	bz := store.Get(key)
	if bz == nil {
		return math.ZeroInt()
	}

	amount, ok := math.NewIntFromString(string(bz))
	if !ok {
		return math.ZeroInt()
	}
	return amount
}

// SetWithdrawalBalance sets the withdrawal balance for a given public key
func (k Keeper) SetWithdrawalBalance(ctx sdk.Context, publicKey string, amount math.Int) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	key := append(types.WithdrawalBalancesKeyPrefix, []byte(publicKey)...)

	store.Set(key, []byte(amount.String()))
}

// GetRewardBalance returns the reward balance for a given public key
func (k Keeper) GetRewardBalance(ctx sdk.Context, publicKey string) math.Int {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	key := append(types.RewardBalancesKeyPrefix, []byte(publicKey)...)

	bz := store.Get(key)
	if bz == nil {
		return math.ZeroInt()
	}

	amount, ok := math.NewIntFromString(string(bz))
	if !ok {
		return math.ZeroInt()
	}
	return amount
}

// SetRewardBalance sets the reward balance for a given public key
func (k Keeper) SetRewardBalance(ctx sdk.Context, publicKey string, amount math.Int) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	key := append(types.RewardBalancesKeyPrefix, []byte(publicKey)...)

	store.Set(key, []byte(amount.String()))
}

// GetApprovedActions returns all approved actions
func (k Keeper) GetApprovedActions(ctx sdk.Context) []types.PulsarAction {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := store.Get(types.ApprovedActionsKey)

	if bz == nil {
		return []types.PulsarAction{}
	}

	var actionsList types.PulsarActionList
	k.cdc.MustUnmarshal(bz, &actionsList)
	return actionsList.Actions
}

// SetApprovedActions sets the approved actions list
func (k Keeper) SetApprovedActions(ctx sdk.Context, actions []types.PulsarAction) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	actionsList := types.PulsarActionList{Actions: actions}
	bz := k.cdc.MustMarshal(&actionsList)
	store.Set(types.ApprovedActionsKey, bz)
}

// GetApprovedActionHash returns the approved action hash
func (k Keeper) GetApprovedActionHash(ctx sdk.Context) string {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := store.Get(types.ApprovedActionHashKey)

	if bz == nil {
		return ""
	}

	return string(bz)
}

// SetApprovedActionHash sets the approved action hash
func (k Keeper) SetApprovedActionHash(ctx sdk.Context, hash string) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store.Set(types.ApprovedActionHashKey, []byte(hash))
}

// GetAllActionHash returns the all action hash
func (k Keeper) GetAllActionHash(ctx sdk.Context) string {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := store.Get(types.AllActionHashKey)

	if bz == nil {
		return ""
	}

	return string(bz)
}

// SetAllActionHash sets the all action hash
func (k Keeper) SetAllActionHash(ctx sdk.Context, hash string) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store.Set(types.AllActionHashKey, []byte(hash))
}

// GetSettledBlockHeight returns the settled block height
func (k Keeper) GetSettledBlockHeight(ctx sdk.Context) uint64 {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := store.Get(types.SettledBlockHeightKey)

	if bz == nil {
		return 0
	}

	return binary.BigEndian.Uint64(bz)
}

// SetSettledBlockHeight sets the settled block height
func (k Keeper) SetSettledBlockHeight(ctx sdk.Context, height uint64) {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	bz := make([]byte, 8)
	binary.BigEndian.PutUint64(bz, height)
	store.Set(types.SettledBlockHeightKey, bz)
}

// GetAllWithdrawalBalances returns all withdrawal balances
func (k Keeper) GetAllWithdrawalBalances(ctx sdk.Context) []types.WithdrawalBalance {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	iterator := storetypes.KVStorePrefixIterator(store, types.WithdrawalBalancesKeyPrefix)
	defer iterator.Close()

	var balances []types.WithdrawalBalance
	for ; iterator.Valid(); iterator.Next() {
		publicKey := string(iterator.Key()[len(types.WithdrawalBalancesKeyPrefix):])

		amount, ok := math.NewIntFromString(string(iterator.Value()))
		if !ok {
			amount = math.ZeroInt()
		}

		balances = append(balances, types.WithdrawalBalance{
			PublicKey: publicKey,
			Amount:    amount,
		})
	}

	return balances
}

// GetAllRewardBalances returns all reward balances
func (k Keeper) GetAllRewardBalances(ctx sdk.Context) []types.RewardBalance {
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	iterator := storetypes.KVStorePrefixIterator(store, types.RewardBalancesKeyPrefix)
	defer iterator.Close()

	var balances []types.RewardBalance
	for ; iterator.Valid(); iterator.Next() {
		publicKey := string(iterator.Key()[len(types.RewardBalancesKeyPrefix):])

		amount, ok := math.NewIntFromString(string(iterator.Value()))
		if !ok {
			amount = math.ZeroInt()
		}

		balances = append(balances, types.RewardBalance{
			PublicKey: publicKey,
			Amount:    amount,
		})
	}

	return balances
}
