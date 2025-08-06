package keeper_test

import (
	"context"
	"strconv"
	"testing"

	keepertest "github.com/cosmos/interchain-security/v5/testutil/keeper"
	"github.com/cosmos/interchain-security/v5/testutil/nullify"
	"github.com/cosmos/interchain-security/v5/x/minakeys/keeper"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
	"github.com/stretchr/testify/require"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func createNVoteExt(keeper keeper.Keeper, ctx context.Context, n int) []types.VoteExt {
	items := make([]types.VoteExt, n)
	for i := range items {
		items[i].Index = strconv.Itoa(i)

		keeper.SetVoteExt(ctx, items[i])
	}
	return items
}

func TestVoteExtGet(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNVoteExt(keeper, ctx, 10)
	for _, item := range items {
		rst, found := keeper.GetVoteExt(ctx,
			item.Index,
		)
		require.True(t, found)
		require.Equal(t,
			nullify.Fill(&item),
			nullify.Fill(&rst),
		)
	}
}
func TestVoteExtRemove(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNVoteExt(keeper, ctx, 10)
	for _, item := range items {
		keeper.RemoveVoteExt(ctx,
			item.Index,
		)
		_, found := keeper.GetVoteExt(ctx,
			item.Index,
		)
		require.False(t, found)
	}
}

func TestVoteExtGetAll(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNVoteExt(keeper, ctx, 10)
	require.ElementsMatch(t,
		nullify.Fill(items),
		nullify.Fill(keeper.GetAllVoteExt(ctx)),
	)
}
