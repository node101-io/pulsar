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

func (k Keeper) KeyStoreAll(ctx context.Context, req *types.QueryAllKeyStoreRequest) (*types.QueryAllKeyStoreResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	var keyStores []types.KeyStore

	store := runtime.KVStoreAdapter(k.storeService.OpenKVStore(ctx))
	keyStoreStore := prefix.NewStore(store, types.KeyPrefix(types.KeyStoreKeyPrefix))

	pageRes, err := query.Paginate(keyStoreStore, req.Pagination, func(key []byte, value []byte) error {
		var keyStore types.KeyStore
		if err := k.cdc.Unmarshal(value, &keyStore); err != nil {
			return err
		}

		keyStores = append(keyStores, keyStore)
		return nil
	})

	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &types.QueryAllKeyStoreResponse{KeyStore: keyStores, Pagination: pageRes}, nil
}

func (k Keeper) KeyStore(ctx context.Context, req *types.QueryGetKeyStoreRequest) (*types.QueryGetKeyStoreResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	val, found := k.GetKeyStore(
		ctx,
		req.Index,
	)
	if !found {
		return nil, status.Error(codes.NotFound, "not found")
	}

	return &types.QueryGetKeyStoreResponse{KeyStore: val}, nil
}
