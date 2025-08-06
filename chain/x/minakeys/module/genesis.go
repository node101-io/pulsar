package minakeys

import (
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/cosmos/interchain-security/v5/x/minakeys/keeper"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
)

// InitGenesis initializes the module's state from a provided genesis state.
func InitGenesis(ctx sdk.Context, k keeper.Keeper, genState types.GenesisState) {
	// Set all the keyStore
	for _, elem := range genState.KeyStoreList {
		k.SetKeyStore(ctx, elem)
	}
	// Set all the voteExt
	for _, elem := range genState.VoteExtList {
		k.SetVoteExt(ctx, elem)
	}
	// this line is used by starport scaffolding # genesis/module/init
	if err := k.SetParams(ctx, genState.Params); err != nil {
		panic(err)
	}
}

// ExportGenesis returns the module's exported genesis.
func ExportGenesis(ctx sdk.Context, k keeper.Keeper) *types.GenesisState {
	genesis := types.DefaultGenesis()
	genesis.Params = k.GetParams(ctx)

	genesis.KeyStoreList = k.GetAllKeyStore(ctx)
	genesis.VoteExtList = k.GetAllVoteExt(ctx)
	// this line is used by starport scaffolding # genesis/module/export

	return genesis
}
