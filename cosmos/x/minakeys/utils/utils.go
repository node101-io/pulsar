package utils

import (
	"encoding/hex"

	"fmt"

	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

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

// VerifyMinaSignature checks that sigBz is a valid signature of message by the provided Mina public key (hex-encoded).
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

// LoadSecondaryKeyFromHex takes the hex-string, decodes + unmarshals it.
func LoadSecondaryKeyFromHex(hexStr string) (*types.SecondaryKey, error) {
	if hexStr == "" {
		return nil, fmt.Errorf("minakeys.secondary_key_hex must be set")
	}

	raw, err := hex.DecodeString(hexStr)
	if err != nil {
		return nil, fmt.Errorf("failed to hex-decode secondary key: %w", err)
	}

	// unmarshal into your SecretKey type
	var sk mina.SecretKey
	if err := sk.UnmarshalBinary(raw); err != nil {
		return nil, fmt.Errorf("failed to unmarshal secondary key: %w", err)
	}

	// derive the public key
	pk := sk.GetPublicKey()

	return &types.SecondaryKey{
		SecretKey: &sk,
		PublicKey: pk,
	}, nil
}
