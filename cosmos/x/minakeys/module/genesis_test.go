package minakeys_test

import (
	"testing"

	keepertest "github.com/node101-io/pulsar/cosmos/testutil/keeper"
	"github.com/node101-io/pulsar/cosmos/testutil/nullify"
	minakeys "github.com/node101-io/pulsar/cosmos/x/minakeys/module"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
	"github.com/stretchr/testify/require"
)

func TestGenesis(t *testing.T) {
	genesisState := types.GenesisState{
		Params: types.DefaultParams(),

		// this line is used by starport scaffolding # genesis/test/state
	}

	k, ctx := keepertest.MinakeysKeeper(t)
	minakeys.InitGenesis(ctx, k, genesisState)
	got := minakeys.ExportGenesis(ctx, k)
	require.NotNil(t, got)

	nullify.Fill(&genesisState)
	nullify.Fill(got)

	// this line is used by starport scaffolding # genesis/test/assert
}
