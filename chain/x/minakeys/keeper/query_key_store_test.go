package keeper_test

import (
	"strconv"
	"testing"

	"github.com/cosmos/cosmos-sdk/types/query"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	keepertest "github.com/cosmos/interchain-security/v5/testutil/keeper"
	"github.com/cosmos/interchain-security/v5/testutil/nullify"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func TestKeyStoreQuerySingle(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	msgs := createNKeyStore(keeper, ctx, 2)
	tests := []struct {
		desc     string
		request  *types.QueryGetKeyStoreRequest
		response *types.QueryGetKeyStoreResponse
		err      error
	}{
		{
			desc: "First",
			request: &types.QueryGetKeyStoreRequest{
				Index: msgs[0].CosmosPublicKey,
			},
			response: &types.QueryGetKeyStoreResponse{KeyStore: msgs[0]},
		},
		{
			desc: "Second",
			request: &types.QueryGetKeyStoreRequest{
				Index: msgs[1].CosmosPublicKey,
			},
			response: &types.QueryGetKeyStoreResponse{KeyStore: msgs[1]},
		},
		{
			desc: "KeyNotFound",
			request: &types.QueryGetKeyStoreRequest{
				Index: strconv.Itoa(100000),
			},
			err: status.Error(codes.NotFound, "not found"),
		},
		{
			desc: "InvalidRequest",
			err:  status.Error(codes.InvalidArgument, "invalid request"),
		},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			response, err := keeper.KeyStore(ctx, tc.request)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
			} else {
				require.NoError(t, err)
				require.Equal(t,
					nullify.Fill(tc.response),
					nullify.Fill(response),
				)
			}
		})
	}
}

func TestKeyStoreQueryPaginated(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	msgs := createNKeyStore(keeper, ctx, 5)

	request := func(next []byte, offset, limit uint64, total bool) *types.QueryAllKeyStoreRequest {
		return &types.QueryAllKeyStoreRequest{
			Pagination: &query.PageRequest{
				Key:        next,
				Offset:     offset,
				Limit:      limit,
				CountTotal: total,
			},
		}
	}
	t.Run("ByOffset", func(t *testing.T) {
		step := 2
		for i := 0; i < len(msgs); i += step {
			resp, err := keeper.KeyStoreAll(ctx, request(nil, uint64(i), uint64(step), false))
			require.NoError(t, err)
			require.LessOrEqual(t, len(resp.KeyStore), step)
			require.Subset(t,
				nullify.Fill(msgs),
				nullify.Fill(resp.KeyStore),
			)
		}
	})
	t.Run("ByKey", func(t *testing.T) {
		step := 2
		var next []byte
		for i := 0; i < len(msgs); i += step {
			resp, err := keeper.KeyStoreAll(ctx, request(next, 0, uint64(step), false))
			require.NoError(t, err)
			require.LessOrEqual(t, len(resp.KeyStore), step)
			require.Subset(t,
				nullify.Fill(msgs),
				nullify.Fill(resp.KeyStore),
			)
			next = resp.Pagination.NextKey
		}
	})
	t.Run("Total", func(t *testing.T) {
		resp, err := keeper.KeyStoreAll(ctx, request(nil, 0, 0, true))
		require.NoError(t, err)
		require.Equal(t, len(msgs), int(resp.Pagination.Total))
		require.ElementsMatch(t,
			nullify.Fill(msgs),
			nullify.Fill(resp.KeyStore),
		)
	})
	t.Run("InvalidRequest", func(t *testing.T) {
		_, err := keeper.KeyStoreAll(ctx, nil)
		require.ErrorIs(t, err, status.Error(codes.InvalidArgument, "invalid request"))
	})
}
