package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/types/query"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
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
