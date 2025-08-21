package bridge

import (
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/cosmos/interchain-security/v5/x/bridge/keeper"
	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

// InitGenesis initializes the module's state from a provided genesis state.
func InitGenesis(ctx sdk.Context, k keeper.Keeper, genState types.GenesisState) {
	// Use the keeper's InitGenesis method which handles all state initialization
	k.InitGenesis(ctx, genState)
}

// ExportGenesis returns the module's exported genesis.
func ExportGenesis(ctx sdk.Context, k keeper.Keeper) *types.GenesisState {
	// Use the keeper's ExportGenesis method which exports all state
	return k.ExportGenesis(ctx)
}
