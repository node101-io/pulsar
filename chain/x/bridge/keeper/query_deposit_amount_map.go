package keeper

import (
	"context"

	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/types/query"
	"github.com/cosmos/interchain-security/v5/x/bridge/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (k Keeper) DepositAmountMapAll(goCtx context.Context, req *types.QueryAllDepositAmountMapRequest) (*types.QueryAllDepositAmountMapResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	var depositAmountMaps []types.DepositAmountMap
	ctx := goCtx

	storeAdapter := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	store := prefix.NewStore(storeAdapter, types.KeyPrefix(types.DepositAmountMapKeyPrefix))

	pageRes, err := query.Paginate(store, req.Pagination, func(key []byte, value []byte) error {
		var depositAmountMap types.DepositAmountMap
		if err := k.cdc.Unmarshal(value, &depositAmountMap); err != nil {
			return err
		}

		depositAmountMaps = append(depositAmountMaps, depositAmountMap)
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryAllDepositAmountMapResponse{DepositAmountMap: depositAmountMaps, Pagination: pageRes}, nil
}

func (k Keeper) DepositAmountMap(goCtx context.Context, req *types.QueryGetDepositAmountMapRequest) (*types.QueryGetDepositAmountMapResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}
	ctx := goCtx

	val, found := k.GetDepositAmountMap(
		ctx,
		req.Address,
	)
	if !found {
		return nil, status.Error(codes.NotFound, "not found")
	}

	return &types.QueryGetDepositAmountMapResponse{DepositAmountMap: val}, nil
}
