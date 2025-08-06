package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/types/query"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (k Keeper) VoteExtAll(ctx context.Context, req *types.QueryAllVoteExtRequest) (*types.QueryAllVoteExtResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	var voteExts []types.VoteExt

	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	voteExtStore := prefix.NewStore(store, types.KeyPrefix(types.VoteExtKeyPrefix))

	pageRes, err := query.Paginate(voteExtStore, req.Pagination, func(key []byte, value []byte) error {
		var voteExt types.VoteExt
		if err := k.cdc.Unmarshal(value, &voteExt); err != nil {
			return err
		}

		voteExts = append(voteExts, voteExt)
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryAllVoteExtResponse{VoteExt: voteExts, Pagination: pageRes}, nil
}

func (k Keeper) VoteExt(ctx context.Context, req *types.QueryGetVoteExtRequest) (*types.QueryGetVoteExtResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	val, found := k.GetVoteExt(
		ctx,
		req.Index,
	)
	if !found {
		return nil, status.Error(codes.NotFound, "not found")
	}

	return &types.QueryGetVoteExtResponse{VoteExt: val}, nil
}

func (k Keeper) VoteExtByHeight(ctx context.Context, req *types.QueryVoteExtByHeightRequest) (*types.QueryVoteExtByHeightResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	// Get all VoteExt for the given height
	voteExts := k.GetVoteExtsByHeight(ctx, req.BlockHeight)

	// Apply manual pagination since we get the data from keeper method
	var paginatedVoteExts []types.VoteExt
	var pageRes *query.PageResponse

	if req.Pagination != nil {
		// Calculate offset and limit
		offset := int(req.Pagination.Offset)
		limit := int(req.Pagination.Limit)

		// Default limit if not specified
		if limit == 0 {
			limit = query.DefaultLimit
		}

		// Apply pagination
		start := offset
		end := offset + limit

		if start >= len(voteExts) {
			paginatedVoteExts = []types.VoteExt{}
		} else {
			if end > len(voteExts) {
				end = len(voteExts)
			}
			paginatedVoteExts = voteExts[start:end]
		}

		// Create pagination response
		pageRes = &query.PageResponse{
			Total: uint64(len(voteExts)),
		}

		// Set next key if there are more results
		if end < len(voteExts) {
			pageRes.NextKey = []byte("next")
		}
	} else {
		// No pagination requested, return all results
		paginatedVoteExts = voteExts
		pageRes = &query.PageResponse{
			Total: uint64(len(voteExts)),
		}
	}

	return &types.QueryVoteExtByHeightResponse{
		VoteExt:    paginatedVoteExts,
		Pagination: pageRes,
	}, nil
}
