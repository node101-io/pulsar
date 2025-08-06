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

func TestVoteExtQuerySingle(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	msgs := createNVoteExt(keeper, ctx, 2)
	tests := []struct {
		desc     string
		request  *types.QueryGetVoteExtRequest
		response *types.QueryGetVoteExtResponse
		err      error
	}{
		{
			desc: "First",
			request: &types.QueryGetVoteExtRequest{
				Index: msgs[0].Index,
			},
			response: &types.QueryGetVoteExtResponse{VoteExt: msgs[0]},
		},
		{
			desc: "Second",
			request: &types.QueryGetVoteExtRequest{
				Index: msgs[1].Index,
			},
			response: &types.QueryGetVoteExtResponse{VoteExt: msgs[1]},
		},
		{
			desc: "KeyNotFound",
			request: &types.QueryGetVoteExtRequest{
				Index: strconv.Itoa(100000),
			},
			err: status.Error(codes.NotFound, "not found"),
		},
		{
			desc:    "InvalidRequest",
			request: nil,
			err:     status.Error(codes.InvalidArgument, "invalid request"),
		},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			response, err := keeper.VoteExt(ctx, tc.request)
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

func TestVoteExtQueryPaginated(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)
	msgs := createNVoteExt(keeper, ctx, 5)

	request := func(next []byte, offset, limit uint64, total bool) *types.QueryAllVoteExtRequest {
		return &types.QueryAllVoteExtRequest{
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
			resp, err := keeper.VoteExtAll(ctx, request(nil, uint64(i), uint64(step), false))
			require.NoError(t, err)
			require.LessOrEqual(t, len(resp.VoteExt), step)
			require.Subset(t,
				nullify.Fill(msgs),
				nullify.Fill(resp.VoteExt),
			)
		}
	})
	t.Run("ByKey", func(t *testing.T) {
		step := 2
		var next []byte
		for i := 0; i < len(msgs); i += step {
			resp, err := keeper.VoteExtAll(ctx, request(next, 0, uint64(step), false))
			require.NoError(t, err)
			require.LessOrEqual(t, len(resp.VoteExt), step)
			require.Subset(t,
				nullify.Fill(msgs),
				nullify.Fill(resp.VoteExt),
			)
			next = resp.Pagination.NextKey
		}
	})
	t.Run("Total", func(t *testing.T) {
		resp, err := keeper.VoteExtAll(ctx, request(nil, 0, 0, true))
		require.NoError(t, err)
		require.Equal(t, len(msgs), int(resp.Pagination.Total))
		require.ElementsMatch(t,
			nullify.Fill(msgs),
			nullify.Fill(resp.VoteExt),
		)
	})
	t.Run("InvalidRequest", func(t *testing.T) {
		_, err := keeper.VoteExtAll(ctx, nil)
		require.ErrorIs(t, err, status.Error(codes.InvalidArgument, "invalid request"))
	})
}

func TestVoteExtByHeightQuery(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)

	// Create test data with different heights
	height1, height2 := uint64(100), uint64(200)

	// Create VoteExt for height 100
	voteExt1 := types.VoteExt{
		Index:         "100/validator1",
		Height:        height1,
		ValidatorAddr: "validator1",
		Signature:     "signature1",
	}
	voteExt2 := types.VoteExt{
		Index:         "100/validator2",
		Height:        height1,
		ValidatorAddr: "validator2",
		Signature:     "signature2",
	}

	// Create VoteExt for height 200
	voteExt3 := types.VoteExt{
		Index:         "200/validator3",
		Height:        height2,
		ValidatorAddr: "validator3",
		Signature:     "signature3",
	}

	// Set VoteExt and update index mappings
	keeper.SetVoteExt(ctx, voteExt1)
	keeper.SetVoteExtIndex(ctx, height1, voteExt1.Index)

	keeper.SetVoteExt(ctx, voteExt2)
	keeper.SetVoteExtIndex(ctx, height1, voteExt2.Index)

	keeper.SetVoteExt(ctx, voteExt3)
	keeper.SetVoteExtIndex(ctx, height2, voteExt3.Index)

	tests := []struct {
		desc     string
		request  *types.QueryVoteExtByHeightRequest
		expected []types.VoteExt
		err      error
	}{
		{
			desc: "Height 100 - should return 2 VoteExt",
			request: &types.QueryVoteExtByHeightRequest{
				BlockHeight: height1,
			},
			expected: []types.VoteExt{voteExt1, voteExt2},
		},
		{
			desc: "Height 200 - should return 1 VoteExt",
			request: &types.QueryVoteExtByHeightRequest{
				BlockHeight: height2,
			},
			expected: []types.VoteExt{voteExt3},
		},
		{
			desc: "Height 300 - should return empty",
			request: &types.QueryVoteExtByHeightRequest{
				BlockHeight: 300,
			},
			expected: []types.VoteExt{},
		},
		{
			desc:    "Invalid request - nil",
			request: nil,
			err:     status.Error(codes.InvalidArgument, "invalid request"),
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			response, err := keeper.VoteExtByHeight(ctx, tc.request)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
			} else {
				require.NoError(t, err)
				require.Equal(t, len(tc.expected), len(response.VoteExt))
				require.ElementsMatch(t,
					nullify.Fill(tc.expected),
					nullify.Fill(response.VoteExt),
				)
				require.NotNil(t, response.Pagination)
				require.Equal(t, uint64(len(tc.expected)), response.Pagination.Total)
			}
		})
	}
}

func TestVoteExtByHeightQueryWithPagination(t *testing.T) {
	keeper, ctx := keepertest.MinakeysKeeper(t)

	// Create test data with same height
	height := uint64(100)
	var voteExts []types.VoteExt

	for i := 0; i < 5; i++ {
		voteExt := types.VoteExt{
			Index:         "100/validator" + strconv.Itoa(i),
			Height:        height,
			ValidatorAddr: "validator" + strconv.Itoa(i),
			Signature:     "signature" + strconv.Itoa(i),
		}
		keeper.SetVoteExt(ctx, voteExt)
		keeper.SetVoteExtIndex(ctx, height, voteExt.Index)
		voteExts = append(voteExts, voteExt)
	}

	t.Run("WithPagination", func(t *testing.T) {
		// Test with limit 2
		resp, err := keeper.VoteExtByHeight(ctx, &types.QueryVoteExtByHeightRequest{
			BlockHeight: height,
			Pagination: &query.PageRequest{
				Limit: 2,
			},
		})
		require.NoError(t, err)
		require.Equal(t, 2, len(resp.VoteExt))
		require.Equal(t, uint64(5), resp.Pagination.Total)
		require.NotNil(t, resp.Pagination.NextKey)
	})

	t.Run("WithOffset", func(t *testing.T) {
		// Test with offset 2, limit 2
		resp, err := keeper.VoteExtByHeight(ctx, &types.QueryVoteExtByHeightRequest{
			BlockHeight: height,
			Pagination: &query.PageRequest{
				Offset: 2,
				Limit:  2,
			},
		})
		require.NoError(t, err)
		require.Equal(t, 2, len(resp.VoteExt))
		require.Equal(t, uint64(5), resp.Pagination.Total)
	})

	t.Run("WithOffsetBeyondResults", func(t *testing.T) {
		// Test with offset beyond results
		resp, err := keeper.VoteExtByHeight(ctx, &types.QueryVoteExtByHeightRequest{
			BlockHeight: height,
			Pagination: &query.PageRequest{
				Offset: 10,
				Limit:  2,
			},
		})
		require.NoError(t, err)
		require.Equal(t, 0, len(resp.VoteExt))
		require.Equal(t, uint64(5), resp.Pagination.Total)
	})
}
