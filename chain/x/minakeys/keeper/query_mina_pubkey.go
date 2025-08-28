package keeper

import (
	"context"
	"strconv"

	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/types"
	"github.com/node101-io/mina-signer-go/keys"
)

func (k Keeper) GetMinaPubkey(ctx context.Context, req *types.QueryGetMinaPubkeyRequest) (*types.QueryGetMinaPubkeyResponse, error) {
	pubKey, err := keys.PublicKey{}.FromAddress(req.ValidatorAddr)
	if err != nil {
		return nil, err
	}

	return &types.QueryGetMinaPubkeyResponse{
		X:     pubKey.X.String(),
		IsOdd: strconv.FormatBool(pubKey.IsOdd),
	}, nil
}
