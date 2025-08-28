package keeper

import (
	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/bridge/types"
)

// MintPMina mints pMINA tokens to a user account
func (k Keeper) MintPMina(ctx sdk.Context, recipient sdk.AccAddress, amount math.Int) error {
	params := k.GetParams(ctx)

	// Create coins to mint
	coins := sdk.NewCoins(sdk.NewCoin(params.PminaDenom, amount))

	// Mint coins to module account
	if err := k.bankKeeper.MintCoins(ctx, types.ModuleName, coins); err != nil {
		return err
	}

	// Send from module to recipient
	return k.bankKeeper.SendCoinsFromModuleToAccount(ctx, types.ModuleName, recipient, coins)
}

// BurnPMina burns pMINA tokens from a user account
func (k Keeper) BurnPMina(ctx sdk.Context, sender sdk.AccAddress, amount math.Int) error {
	params := k.GetParams(ctx)

	// Create coins to burn
	coins := sdk.NewCoins(sdk.NewCoin(params.PminaDenom, amount))

	// Send from user to module
	if err := k.bankKeeper.SendCoinsFromAccountToModule(ctx, sender, types.ModuleName, coins); err != nil {
		return err
	}

	// Burn coins from module account
	return k.bankKeeper.BurnCoins(ctx, types.ModuleName, coins)
}

// GetPMinaBalance returns pMINA balance of an account
func (k Keeper) GetPMinaBalance(ctx sdk.Context, addr sdk.AccAddress) math.Int {
	params := k.GetParams(ctx)
	balance := k.bankKeeper.GetBalance(ctx, addr, params.PminaDenom)
	return balance.Amount
}

// HasSufficientPMinaBalance checks if an account has sufficient pMINA balance
func (k Keeper) HasSufficientPMinaBalance(ctx sdk.Context, addr sdk.AccAddress, amount math.Int) bool {
	balance := k.GetPMinaBalance(ctx, addr)
	return balance.GTE(amount)
}
