package keeper

import (
	"context"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

func (k msgServer) LockForWithdrawal(goCtx context.Context, msg *types.MsgLockForWithdrawal) (*types.MsgLockForWithdrawalResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	// Validate message
	if err := msg.ValidateBasic(); err != nil {
		return nil, err
	}

	sender, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return nil, types.ErrInvalidSigner
	}

	// Check if user has sufficient pMINA balance
	if !k.HasSufficientPMinaBalance(ctx, sender, msg.Amount) {
		return nil, types.ErrInsufficientBalance
	}

	// Get commission rate from params
	params := k.GetParams(ctx)
	commissionRate := params.CommissionRate

	// Calculate net amount after commission (98% goes to withdrawal balance, 2% burned as commission)
	netAmount := msg.Amount.ToLegacyDec().Mul(math.LegacyOneDec().Sub(commissionRate)).TruncateInt()

	// Burn the full amount from user
	if err := k.BurnPMina(ctx, sender, msg.Amount); err != nil {
		return nil, err
	}

	// Add net amount to withdrawal balance
	currentBalance := k.GetWithdrawalBalance(ctx, msg.MinaPublicKey)
	newBalance := currentBalance.Add(netAmount)
	k.SetWithdrawalBalance(ctx, msg.MinaPublicKey, newBalance)

	// Log the transaction
	ctx.Logger().Info("LockForWithdrawal transaction executed",
		"creator", msg.Creator,
		"mina_public_key", msg.MinaPublicKey,
		"amount", msg.Amount.String(),
		"net_amount", netAmount.String(),
		"commission", msg.Amount.Sub(netAmount).String(),
	)

	// Emit event
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			"withdrawal_locked",
			sdk.NewAttribute("sender", msg.Creator),
			sdk.NewAttribute("mina_public_key", msg.MinaPublicKey),
			sdk.NewAttribute("amount", msg.Amount.String()),
			sdk.NewAttribute("net_amount", netAmount.String()),
			sdk.NewAttribute("commission", msg.Amount.Sub(netAmount).String()),
		),
	)

	return &types.MsgLockForWithdrawalResponse{}, nil
}
