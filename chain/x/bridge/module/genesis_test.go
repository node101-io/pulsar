package bridge_test

import (
	"testing"

	keepertest "github.com/node101-io/pulsar/chain/testutil/keeper"
	"github.com/node101-io/pulsar/chain/testutil/nullify"
	bridge "github.com/node101-io/pulsar/chain/x/bridge/module"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
	"github.com/stretchr/testify/require"
)

func TestGenesis(t *testing.T) {
	genesisState := types.GenesisState{
		Params: types.DefaultParams(),
		// this line is used by starport scaffolding # genesis/test/state
	}

	k, ctx := keepertest.BridgeKeeper(t)
	bridge.InitGenesis(ctx, k, genesisState)
	got := bridge.ExportGenesis(ctx, k)
	require.NotNil(t, got)

	nullify.Fill(&genesisState)
	nullify.Fill(got)

	// this line is used by starport scaffolding # genesis/test/assert
}
