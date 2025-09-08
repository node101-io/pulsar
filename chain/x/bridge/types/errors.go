package types

// DONTCOVER

import (
	sdkerrors "cosmossdk.io/errors"
)

// x/bridge module sentinel errors
var (
	ErrInvalidSigner                   = sdkerrors.Register(ModuleName, 1100, "expected gov account as only signer for proposal message")
	ErrSample                          = sdkerrors.Register(ModuleName, 1101, "sample error")
	ErrInvalidPublicKey                = sdkerrors.Register(ModuleName, 1102, "invalid public key")
	ErrInvalidAmount                   = sdkerrors.Register(ModuleName, 1103, "invalid amount")
	ErrInvalidActionType               = sdkerrors.Register(ModuleName, 1104, "invalid action type")
	ErrInsufficientBalance             = sdkerrors.Register(ModuleName, 1105, "insufficient balance")
	ErrInvalidCommissionRate           = sdkerrors.Register(ModuleName, 1106, "invalid commission rate")
	ErrInvalidPMinaDenom               = sdkerrors.Register(ModuleName, 1107, "invalid pMINA denomination")
	ErrInvalidAction                   = sdkerrors.Register(ModuleName, 1108, "invalid action")
	ErrInvalidActionList               = sdkerrors.Register(ModuleName, 1109, "invalid action list")
	ErrInvalidBlockHeight              = sdkerrors.Register(ModuleName, 1110, "invalid block height")
	ErrEmptyActionList                 = sdkerrors.Register(ModuleName, 1111, "empty action list")
	ErrSignerVerification              = sdkerrors.Register(ModuleName, 1112, "signer node verification failed")
	ErrInvalidMerkleWitness            = sdkerrors.Register(ModuleName, 1113, "invalid merkle witness")
	ErrPublicKeyNotRegistered          = sdkerrors.Register(ModuleName, 1114, "mina public key not registered")
	ErrInvalidCosmosAddressOrSignature = sdkerrors.Register(ModuleName, 1115, "invalid cosmos address or cosmos signature")
)
