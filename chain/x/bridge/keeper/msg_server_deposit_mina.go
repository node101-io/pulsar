package keeper

import (
	"context"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

func (k msgServer) DepositMina(goCtx context.Context, msg *types.MsgDepositMina) (*types.MsgDepositMinaResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Log the deposit transaction
	ctx.Logger().Info("DepositMina transaction executed",
		"creator", msg.Creator,
		"amount", msg.Amount,
		"recipient", msg.Recipient,
	)

	k.Keeper.IncrementAmount(ctx, msg.Recipient, msg.Amount)

	// For now, just log and return success
	// Future implementation can include actual deposit logic here

	return &types.MsgDepositMinaResponse{}, nil
}
