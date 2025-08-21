package keeper

import (
	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

// AddProverReward adds reward to a prover's reward balance
func (k Keeper) AddProverReward(ctx sdk.Context, proverAddr string) error {
	// Get current reward balance
	currentReward := k.GetRewardBalance(ctx, proverAddr)

	// Get prover reward amount from params
	params := k.GetParams(ctx)

	// Add reward amount to current balance
	newReward := currentReward.Add(params.ProverReward)

	// Update reward balance
	k.SetRewardBalance(ctx, proverAddr, newReward)

	return nil
}

// GetTotalRewards returns the total rewards for a prover
func (k Keeper) GetTotalRewards(ctx sdk.Context, proverAddr string) math.Int {
	return k.GetRewardBalance(ctx, proverAddr)
}

// ResetRewardBalance resets the reward balance for a prover (used when claiming rewards)
func (k Keeper) ResetRewardBalance(ctx sdk.Context, proverAddr string) {
	k.SetRewardBalance(ctx, proverAddr, math.ZeroInt())
}
