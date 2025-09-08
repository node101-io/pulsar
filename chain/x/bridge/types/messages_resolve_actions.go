package types

import (
	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

var _ sdk.Msg = &MsgResolveActions{}

// NewMsgResolveActions creates a new MsgResolveActions instance
func NewMsgResolveActions(
	creator string,
	actions []PulsarAction,
	nextBlockHeight uint64,
	merkleWitness string,
) *MsgResolveActions {
	return &MsgResolveActions{
		Creator:         creator,
		Actions:         actions,
		NextBlockHeight: nextBlockHeight,
		MerkleWitness:   merkleWitness,
	}
}

// ValidateBasic performs basic validation of the message
func (msg *MsgResolveActions) ValidateBasic() error {
	// Validate creator address
	_, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidAddress, "invalid creator address (%s)", err)
	}

	// Validate actions list
	if len(msg.Actions) == 0 {
		return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "actions list cannot be empty")
	}

	// Validate next block height
	if msg.NextBlockHeight == 0 {
		return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "next block height cannot be zero")
	}

	// Validate merkle witness (basic validation - not empty)
	if msg.MerkleWitness == "" {
		return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "merkle witness cannot be empty")
	}

	// Validate each action
	for i, action := range msg.Actions {
		if err := validatePulsarAction(action, i); err != nil {
			return err
		}
	}

	return nil
}

// validatePulsarAction validates a single PulsarAction
func validatePulsarAction(action PulsarAction, index int) error {
	// Validate public key
	if action.PublicKey == "" {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidRequest, "action %d: public key cannot be empty", index)
	}

	// Basic length validation for Mina public key
	if len(action.PublicKey) < 10 {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidRequest, "action %d: public key too short", index)
	}

	// Validate amount
	if action.Amount.IsZero() || action.Amount.IsNegative() {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidRequest, "action %d: amount must be positive", index)
	}

	// Validate action type
	validActionTypes := map[string]bool{
		"deposit":    true,
		"withdrawal": true,
		"settlement": true,
	}

	if !validActionTypes[action.ActionType] {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidRequest, "action %d: invalid action type '%s', must be one of: deposit, withdrawal, settlement", index, action.ActionType)
	}

	// Validate block height
	if action.CosmosAddress == "" || action.CosmosSignature == "" {
		return errorsmod.Wrapf(sdkerrors.ErrInvalidRequest, "action %d: cosmos address or cosmos signature cannot be empty", index)
	}

	return nil
}

// GetSigners returns the signers of the message
func (msg *MsgResolveActions) GetSigners() []sdk.AccAddress {
	creator, err := sdk.AccAddressFromBech32(msg.Creator)
	if err != nil {
		panic(err)
	}
	return []sdk.AccAddress{creator}
}
