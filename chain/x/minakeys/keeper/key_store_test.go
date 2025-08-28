package keeper_test

import (
	"context"
	"strconv"
	"testing"

	keepertest "github.com/node101-io/pulsar/chain/testutil/keeper"
	"github.com/node101-io/pulsar/chain/testutil/nullify"
	"github.com/node101-io/pulsar/chain/x/minakeys/keeper"
	"github.com/node101-io/pulsar/chain/x/minakeys/types"
	"github.com/stretchr/testify/require"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func createNKeyStore(keeper keeper.Keeper, ctx context.Context, n int) []types.KeyStore {
	items := make([]types.KeyStore, n)
	for i := range items {
		items[i].CosmosPublicKey = strconv.Itoa(i)

		keeper.SetKeyStore(ctx, items[i])
	}
	return items
}

func TestKeyStoreGet(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNKeyStore(keeper, ctx, 10)
	for _, item := range items {
		rst, found := keeper.GetKeyStore(ctx,
			item.CosmosPublicKey,
		)
		require.True(t, found)
		require.Equal(t,
			nullify.Fill(&item),
			nullify.Fill(&rst),
		)
	}
}
func TestKeyStoreRemove(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNKeyStore(keeper, ctx, 10)
	for _, item := range items {
		keeper.RemoveKeyStore(ctx,
			item.CosmosPublicKey,
		)
		_, found := keeper.GetKeyStore(ctx,
			item.CosmosPublicKey,
		)
		require.False(t, found)
	}
}

func TestKeyStoreGetAll(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	items := createNKeyStore(keeper, ctx, 10)
	require.ElementsMatch(t,
		nullify.Fill(items),
		nullify.Fill(keeper.GetAllKeyStore(ctx)),
	)
}
