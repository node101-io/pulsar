package keeper_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	keepertest "github.com/node101-io/pulsar/cosmos/testutil/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

func TestGetParams(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	params := types.DefaultParams()

	require.NoError(t, k.SetParams(ctx, params))
	require.EqualValues(t, params, k.GetParams(ctx))
}
