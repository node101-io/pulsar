package keeper

import (
	"context"

	"cosmossdk.io/math"
	"cosmossdk.io/store/prefix"
	"github.com/cosmos/cosmos-sdk/runtime"
	"github.com/cosmos/cosmos-sdk/types/query"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/bridge/types"
)

// WithdrawalBalance queries withdrawal balance by public key
func (k Keeper) WithdrawalBalance(goCtx context.Context, req *types.QueryWithdrawalBalanceRequest) (*types.QueryWithdrawalBalanceResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)
	balance := k.GetWithdrawalBalance(ctx, req.PublicKey)

	return &types.QueryWithdrawalBalanceResponse{
		Amount: balance,
	}, nil
}

// WithdrawalBalances queries all withdrawal balances
func (k Keeper) WithdrawalBalances(goCtx context.Context, req *types.QueryWithdrawalBalancesRequest) (*types.QueryWithdrawalBalancesResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	withdrawalStore := prefix.NewStore(store, types.WithdrawalBalancesKeyPrefix)

	var balances []types.WithdrawalBalance
	pageRes, err := query.Paginate(withdrawalStore, req.Pagination, func(key []byte, value []byte) error {
		publicKey := string(key)
		amount, ok := math.NewIntFromString(string(value))
		if !ok {
			amount = math.ZeroInt()
		}

		balances = append(balances, types.WithdrawalBalance{
			PublicKey: publicKey,
			Amount:    amount,
		})
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryWithdrawalBalancesResponse{
		WithdrawalBalances: balances,
		Pagination:         pageRes,
	}, nil
}

// RewardBalance queries reward balance by public key
func (k Keeper) RewardBalance(goCtx context.Context, req *types.QueryRewardBalanceRequest) (*types.QueryRewardBalanceResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)
	balance := k.GetRewardBalance(ctx, req.PublicKey)

	return &types.QueryRewardBalanceResponse{
		Amount: balance,
	}, nil
}

// RewardBalances queries all reward balances
func (k Keeper) RewardBalances(goCtx context.Context, req *types.QueryRewardBalancesRequest) (*types.QueryRewardBalancesResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)
	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	rewardStore := prefix.NewStore(store, types.RewardBalancesKeyPrefix)

	var balances []types.RewardBalance
	pageRes, err := query.Paginate(rewardStore, req.Pagination, func(key []byte, value []byte) error {
		publicKey := string(key)
		amount, ok := math.NewIntFromString(string(value))
		if !ok {
			amount = math.ZeroInt()
		}

		balances = append(balances, types.RewardBalance{
			PublicKey: publicKey,
			Amount:    amount,
		})
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryRewardBalancesResponse{
		RewardBalances: balances,
		Pagination:     pageRes,
	}, nil
}

// ApprovedActions queries approved actions
func (k Keeper) ApprovedActions(goCtx context.Context, req *types.QueryApprovedActionsRequest) (*types.QueryApprovedActionsResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)
	actions := k.GetApprovedActions(ctx)

	// For simplicity, we'll return all actions without pagination for now
	// In a production environment, you might want to implement proper pagination
	return &types.QueryApprovedActionsResponse{
		ApprovedActions: actions,
		Pagination:      nil,
	}, nil
}

// BridgeState queries the complete bridge state
func (k Keeper) BridgeState(goCtx context.Context, req *types.QueryBridgeStateRequest) (*types.QueryBridgeStateResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	ctx := sdk.UnwrapSDKContext(goCtx)

	bridgeState := types.BridgeState{
		WithdrawalBalances: k.GetAllWithdrawalBalances(ctx),
		RewardBalances:     k.GetAllRewardBalances(ctx),
		ApprovedActions:    k.GetApprovedActions(ctx),
		ApprovedActionHash: k.GetApprovedActionHash(ctx),
		AllActionHash:      k.GetAllActionHash(ctx),
		SettledBlockHeight: k.GetSettledBlockHeight(ctx),
	}

	return &types.QueryBridgeStateResponse{
		BridgeState: bridgeState,
	}, nil
}
