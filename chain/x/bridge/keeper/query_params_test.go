package keeper_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	keepertest "github.com/node101-io/pulsar/chain/testutil/keeper"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

func TestParamsQuery(t *testing.T) {
	keeper, ctx := keepertest.BridgeKeeper(t)
	params := types.DefaultParams()
	require.NoError(t, keeper.SetParams(ctx, params))

	response, err := keeper.Params(ctx, &types.QueryParamsRequest{})
	require.NoError(t, err)
	require.Equal(t, &types.QueryParamsResponse{Params: params}, response)
}
