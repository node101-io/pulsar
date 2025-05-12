package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgCreateKeyStore{}

func NewMsgCreateKeyStore(
	creator string,
	cosmosPublicKey string,
	minaPublicKey string,
	cosmosSignature []byte,
	minaSignature []byte,

) *MsgCreateKeyStore {
	return &MsgCreateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPublicKey,
		MinaPublicKey:   minaPublicKey,
		CosmosSignature: cosmosSignature,
		MinaSignature:   minaSignature,
	}
}

func (msg *MsgCreateKeyStore) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}

var _ sdk.Msg = &MsgUpdateKeyStore{}

func NewMsgUpdateKeyStore(
	creator string,
	cosmosPublicKey string,
	minaPublicKey string,
	cosmosSignature []byte,
	minaSignature []byte,

) *MsgUpdateKeyStore {
	return &MsgUpdateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPublicKey,
		MinaPublicKey:   minaPublicKey,
		CosmosSignature: cosmosSignature,
		MinaSignature:   minaSignature,
	}
}

func (msg *MsgUpdateKeyStore) ValidateBasic() error {
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}
	return nil
}
