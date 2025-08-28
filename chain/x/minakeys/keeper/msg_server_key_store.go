package keeper

import (
	"context"

	"encoding/hex"

	errorsmod "cosmossdk.io/errors"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/types"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/utils"
)

func (k msgServer) CreateKeyStore(goCtx context.Context, msg *types.MsgCreateKeyStore) (*types.MsgCreateKeyStoreResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	index := msg.Creator

	// Derive the expected creator address from the Cosmos public key
	pubKeyBytes, err := hex.DecodeString(msg.CosmosPublicKey)
	if err != nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidAddress, "invalid cosmos public key hex")
	}
	pubKey := secp256k1.PubKey{Key: pubKeyBytes}
	derivedAddr := sdk.AccAddress(pubKey.Address()).String()
	if derivedAddr != msg.Creator {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnauthorized, "creator does not match derived address from Cosmos public key")
	}

	// Check if the value already exists
	if _, found := k.GetKeyStore(ctx, index); found {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "cosmosPublicKey already registered")
	}

	// Verify that the creator signed the MinaPublicKey correctly
	if err := utils.VerifyCosmosSignatureADR36(msg.CosmosPublicKey, msg.Creator, msg.MinaPublicKey, msg.CosmosSignature, ""); err != nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrInvalidRequest, err.Error())
	}

	// Verify that the creator signed the CosmosPublicKey correctly
	if err := utils.VerifyMinaSignature(msg.MinaPublicKey, msg.CosmosPublicKey, msg.MinaSignature); err != nil {
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
