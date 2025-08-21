package types

import (
	sdkerrors "cosmossdk.io/errors"
	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

var _ sdk.Msg = &MsgLockForWithdrawal{}

func NewMsgLockForWithdrawal(creator string, minaPublicKey string, amount math.Int) *MsgLockForWithdrawal {
	return &MsgLockForWithdrawal{
		Creator:       creator,
		MinaPublicKey: minaPublicKey,
		Amount:        amount,
	}
}

func (msg *MsgLockForWithdrawal) ValidateBasic() error {
	// Validate creator address
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return sdkerrors.Wrapf(ErrInvalidSigner, "invalid creator address (%s)", err)
	}

	// Validate Mina public key (basic check - not empty)
	if msg.MinaPublicKey == "" {
		return sdkerrors.Wrap(ErrInvalidPublicKey, "mina public key cannot be empty")
	}

	// Validate amount
	if msg.Amount.IsNil() || msg.Amount.LTE(math.ZeroInt()) {
		return sdkerrors.Wrap(ErrInvalidAmount, "amount must be positive")
	}

	return nil
}

func (msg *MsgLockForWithdrawal) GetSigners() []sdk.AccAddress {
	creator, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		panic(err)
	}
	return []sdk.AccAddress{creator}
}
