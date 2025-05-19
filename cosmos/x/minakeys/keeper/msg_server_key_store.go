package keeper

import (
	"context"

	"encoding/hex"

	errorsmod "cosmossdk.io/errors"
	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

func (k msgServer) CreateKeyStore(goCtx context.Context, msg *types.MsgCreateKeyStore) (*types.MsgCreateKeyStoreResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	index := msg.CosmosPublicKey

	// Check if the value already exists
	_, isFound := k.GetKeyStore(
		ctx,
		index,
	)
	if isFound {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "index already set")
	}

	// Verify that the creator signed the MinaPublicKey correctly
	if err := VerifyCosmosSignature(msg.CosmosPublicKey, msg.MinaPublicKey, msg.CosmosSignature); err != nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, err.Error())
	}

	// Verify that the creator signed the CosmosPublicKey correctly
	if err := VerifyMinaSignature(msg.MinaPublicKey, msg.CosmosPublicKey, msg.MinaSignature); err != nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, err.Error())
	}

	var keyStore = types.KeyStore{
		Creator:         msg.Creator,
		CosmosPublicKey: msg.CosmosPublicKey,
		MinaPublicKey:   msg.MinaPublicKey,
	}

	k.SetKeyStore(
		ctx,
		keyStore,
	)
	return &types.MsgCreateKeyStoreResponse{}, nil
}

func (k msgServer) UpdateKeyStore(goCtx context.Context, msg *types.MsgUpdateKeyStore) (*types.MsgUpdateKeyStoreResponse, error) {
	/*
		// For now, we are not allowing updates to the key store

		ctx := sdk.UnwrapSDKContext(goCtx)

		index := msg.CosmosPublicKey

		// Check if the value exists
		valFound, isFound := k.GetKeyStore(
			ctx,
			index,
		)
		if !isFound {
			return nil, errorsmod.Wrap(sdkerrors.ErrKeyNotFound, "index not set")
		}

		// Checks if the msg creator is the same as the current owner
		if msg.Creator != valFound.Creator {
			return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "incorrect owner")
		}

		var keyStore = types.KeyStore{
			Creator:         msg.Creator,
			CosmosPublicKey: msg.CosmosPublicKey,
			MinaPublicKey:   msg.MinaPublicKey,
		}

		k.SetKeyStore(ctx, keyStore)

		return &types.MsgUpdateKeyStoreResponse{}, nil
	*/

	return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "updating key store is not allowed")

}

// VerifyCosmosSignature checks that sigBz is a valid signature of message by the provided Cosmos secp256k1 public key (hex-encoded).
func VerifyCosmosSignature(cosmosPubKeyHex string, message string, sigBz []byte) error {
	// Decode hex-encoded public key
	pubKeyBytes, err := hex.DecodeString(cosmosPubKeyHex)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("invalid cosmos public key hex")
	}
	// Construct secp256k1 PubKey
	pubKey := secp256k1.PubKey{Key: pubKeyBytes}
	// Verify signature
	if !pubKey.VerifySignature([]byte(message), sigBz) {
		return sdkerrors.ErrUnauthorized.Wrap("invalid cosmos signature")
	}
	return nil
}

func VerifyMinaSignature(minaPubKeyHex string, message string, sigBz []byte) error {
	// Decode hex-encoded public key
	pubKeyBytes, err := hex.DecodeString(minaPubKeyHex)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("invalid mina public key hex")
	}

	// Construct schnorr PubKey
	var pubKey mina.PublicKey
	err = pubKey.UnmarshalBinary(pubKeyBytes)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("invalid mina public key")
	}

	// Decode hex-encoded signature
	var sig mina.Signature
	err = sig.UnmarshalBinary(sigBz)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("signature is not correctly encoded")
	}

	// Verify signature
	if pubKey.VerifyMessage(&sig, message) != nil {
		return sdkerrors.ErrUnauthorized.Wrap("invalid mina signature")
	}
	return nil
}
