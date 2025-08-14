package utils

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"

	"fmt"

	"cosmossdk.io/log"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
	"github.com/node101-io/mina-signer-go/keys"
	"github.com/node101-io/mina-signer-go/signature"
)

// --- ADR-36 Amino StdSignDoc types ---

type adr36MsgSignData struct {
	Signer string `json:"signer"`
	// Base64-encoded raw message bytes per ADR-36
	Data string `json:"data"`
}

type adr36Msg struct {
	Type  string           `json:"type"` // must be "sign/MsgSignData"
	Value adr36MsgSignData `json:"value"`
}

type adr36Fee struct {
	Gas    string `json:"gas"`
	Amount []struct {
		Denom  string `json:"denom"`
		Amount string `json:"amount"`
	} `json:"amount"`
}

type adr36StdSignDoc struct {
	ChainID       string     `json:"chain_id"`       // ""
	AccountNumber string     `json:"account_number"` // "0"
	Sequence      string     `json:"sequence"`       // "0"
	Fee           adr36Fee   `json:"fee"`            // { gas:"0", amount:[] }
	Msgs          []adr36Msg `json:"msgs"`           // single sign/MsgSignData
	Memo          string     `json:"memo"`           // ""
}

// VerifyCosmosSignatureADR36 verifies an ADR-36 signature (64-byte r||s)
// pubKeyHex: 33-byte compressed secp256k1 pubkey (hex-encoded)
// signerBech32: bech32 account (e.g., "cosmos1...") used in MsgSignData
// originalMessage: exact bytes the dApp asked the wallet to sign
// chainID: chain ID used during signing (can be empty string for off-chain signing)
func VerifyCosmosSignatureADR36(pubKeyHex string, signerBech32 string, originalMessage string, sigBz []byte, chainID string) error {
	// 1) Signature length (ADR-36 -> 64 byte r||s)
	if len(sigBz) != 64 {
		return sdkerrors.ErrUnauthorized.Wrapf("invalid signature length: got %d, want 64", len(sigBz))
	}

	// 2) PubKey
	pubKeyBytes, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("invalid cosmos public key hex")
	}
	if len(pubKeyBytes) != 33 {
		return sdkerrors.ErrInvalidAddress.Wrapf("invalid secp256k1 pubkey length: got %d, want 33 (compressed)", len(pubKeyBytes))
	}
	pubKey := secp256k1.PubKey{Key: pubKeyBytes}

	// 3) ADR-36 sign doc
	signDoc := adr36StdSignDoc{
		ChainID:       chainID,
		AccountNumber: "0",
		Sequence:      "0",
		Fee: adr36Fee{
			Gas: "0",
			Amount: []struct {
				Denom  string `json:"denom"`
				Amount string `json:"amount"`
			}{},
		},
		Msgs: []adr36Msg{
			{
				Type: "sign/MsgSignData",
				Value: adr36MsgSignData{
					Signer: signerBech32,
					// data is base64(raw message bytes)
					Data: base64.StdEncoding.EncodeToString([]byte(originalMessage)),
				},
			},
		},
		Memo: "",
	}

	// Amino JSON sign bytes
	raw, err := json.Marshal(signDoc)
	if err != nil {
		return fmt.Errorf("marshal sign doc: %w", err)
	}
	signBytes := sdk.MustSortJSON(raw)

	// Verify signature
	if !pubKey.VerifySignature(signBytes, sigBz) {
		return sdkerrors.ErrUnauthorized.Wrap("invalid ADR-36 signature")
	}
	return nil
}

// VerifyMinaSignature checks that sigBz is a valid signature of message by the provided Mina public key (hex-encoded).
func VerifyMinaSignature(minaAddr string, message string, sigBz []byte) error {
	var minaPubKey keys.PublicKey
	minaPubKey, err := minaPubKey.FromAddress(minaAddr)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("invalid mina public key")
	}

	// Decode hex-encoded signature
	var sig signature.Signature
	err = sig.UnmarshalBytes(sigBz)
	if err != nil {
		return sdkerrors.ErrInvalidAddress.Wrap("signature is not correctly encoded")
	}

	// Verify signature
	if !minaPubKey.VerifyMessageLegacy(&sig, message, types.DevnetNetworkID) {
		return sdkerrors.ErrUnauthorized.Wrap("invalid mina signature")
	}
	return nil
}

// LoadSecondaryKeyFromHex takes the hex-string, decodes + unmarshals it.
func LoadSecondaryKeyFromHex(hexStr string, logger log.Logger) (*types.SecondaryKey, error) {
	if hexStr == "" {
		logger.Error("Hex string is empty", "hexStr", hexStr)
		return nil, fmt.Errorf("minakeys.secondary_key_hex must be set")
	}

	raw, err := hex.DecodeString(hexStr)
	if err != nil {
		logger.Error("Failed to hex-decode secondary key", "error", err)
		return nil, fmt.Errorf("failed to hex-decode secondary key: %w", err)
	}

	// unmarshal into your SecretKey type
	var sk keys.PrivateKey
	if err := sk.UnmarshalBytes(raw); err != nil {
		logger.Error("Failed to unmarshal secondary key", "error", err)
		return nil, fmt.Errorf("failed to unmarshal secondary key: %w", err)
	}

	// derive the public key
	pk := sk.ToPublicKey()
	logger.Info("Successfully loaded secondary key", "pk", pk)

	return &types.SecondaryKey{
		SecretKey: &sk,
		PublicKey: &pk,
	}, nil
}
