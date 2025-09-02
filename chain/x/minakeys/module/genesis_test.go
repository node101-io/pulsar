package minakeys_test

import (
	"testing"

	keepertest "github.com/node101-io/pulsar/chain/testutil/keeper"
	"github.com/node101-io/pulsar/chain/testutil/nullify"
	minakeys "github.com/node101-io/pulsar/chain/x/minakeys/module"
	"github.com/node101-io/pulsar/chain/x/minakeys/types"
	"github.com/stretchr/testify/require"
)

func TestGenesis(t *testing.T) {
	genesisState := types.GenesisState{
		Params: types.DefaultParams(),

		KeyStoreList: []types.KeyStore{
			{
				CosmosPublicKey: "0",
			},
			{
				CosmosPublicKey: "1",
			},
		},
		VoteExtList: []types.VoteExt{
			{
				Index: "0",
			},
			{
				Index: "1",
			},
		},
		// this line is used by starport scaffolding # genesis/test/state
	}

	k, ctx := keepertest.MinakeysKeeper(t)
	minakeys.InitGenesis(ctx, k, genesisState)
	got := minakeys.ExportGenesis(ctx, k)
	require.NotNil(t, got)

	nullify.Fill(&genesisState)
	nullify.Fill(got)

	require.ElementsMatch(t, genesisState.KeyStoreList, got.KeyStoreList)
	require.ElementsMatch(t, genesisState.VoteExtList, got.VoteExtList)
	// this line is used by starport scaffolding # genesis/test/assert
}
