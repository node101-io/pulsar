package signing

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/btcsuite/btcutil/base58"
	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/gogoproto/jsonpb"
	keys "github.com/node101-io/mina-signer-go/keys"
	poseidonbigint "github.com/node101-io/mina-signer-go/poseidonbigint"
	"github.com/node101-io/mina-signer-go/signature"
)

type minaPubKey struct {
	pk *keys.PublicKey
}

func (pk *PubKey) String() string {
	bytes, err := pk.Key.pk.MarshalBytes()
	if err != nil {
		return ""
	}

	return hex.EncodeToString(bytes)
}

func (pk PubKey) Address() cmtcrypto.Address {
	if pk.Key.pk == nil {
		return nil
	}

	// Marshal public key bytes
	bz, err := pk.Key.pk.MarshalBytes()
	if err != nil {
		return nil
	}

	// Encode with Base58 and return as bytes to satisfy Address ([]byte)
	encoded := base58.Encode(bz)
	return cmtcrypto.Address([]byte(encoded))
}

func (pk PubKey) Bytes() []byte {
	if pk.Key.pk == nil {
		return nil
	}

	bytes, err := pk.Key.pk.MarshalBytes()
	if err != nil {
		return nil
	}

	return bytes
}

func (pk *PubKey) VerifySignature(msg []byte, sigBytes []byte) bool {
	// Deserialize the signature
	var sig signature.Signature
	err := sig.UnmarshalBytes(sigBytes)
	if err != nil {
		// Optionally log the error: fmt.Printf("Failed to unmarshal signature: %v\n", err)
		return false
	}

	// Convert the message (msg) into field elements for Poseidon hash.
	// Each field element consists of byte chunks of `FieldElementByteSize` length.
	var fields []*big.Int
	if len(msg) == 0 {
		// Empty message means an empty slice of field elements.
		fields = []*big.Int{}
	} else {
		for i := 0; i < len(msg); i += FieldElementByteSize {
			end := i + FieldElementByteSize
			if end > len(msg) {
				end = len(msg)
			}
			chunk := msg[i:end]

			fieldElement := new(big.Int)
			fieldElement.SetBytes(chunk)
			fields = append(fields, fieldElement)
		}
	}

	hashInput := poseidonbigint.HashInput{
		Fields: fields,
	}

	// Verify the signature against the hash input on the specified network.
	// The `mina-signer-go/keys.PublicKey.Verify` method returns a boolean (true for valid, false for invalid).
	// We use DevnetNetworkID here; ensure this constant is accessible.
	return pk.Key.pk.Verify(&sig, hashInput, DevnetNetworkID)
}

func (pk PubKey) Equals(other cryptotypes.PubKey) bool {
	otherPubKey, ok := other.(*PubKey)
	if !ok {
		return false
	}

	return pk.Key.pk.Equal(*otherPubKey.Key.pk)
}

func (pk *PubKey) Type() string {
	return KeyType
}

func (pk *minaPubKey) Size() int {
	if pk.pk == nil {
		return 0
	}

	return keys.PublicKeyTotalByteSize
}

func (pk *minaPubKey) MarshalTo(dAtA []byte) (int, error) {
	if pk.pk == nil {
		return 0, nil // Nothing to marshal
	}

	keyBytes, err := pk.pk.MarshalBytes()
	if err != nil {
		return 0, fmt.Errorf("failed to marshal public key: %w", err)
	}

	// Ensure the marshaled bytes match the expected size.
	// This is a sanity check, as Size() should already reflect this.
	if len(keyBytes) != keys.PublicKeyTotalByteSize {
		return 0, fmt.Errorf("marshaled key size mismatch: got %d, want %d", len(keyBytes), keys.PublicKeyTotalByteSize)
	}

	if len(dAtA) < keys.PublicKeyTotalByteSize {
		return 0, fmt.Errorf("destination buffer too small: got %d, want at least %d", len(dAtA), keys.PublicKeyTotalByteSize)
	}

	copy(dAtA, keyBytes)
	return keys.PublicKeyTotalByteSize, nil
}

// MarshalJSON provides custom JSON serialization for minaPubKey.
func (pk *minaPubKey) MarshalJSON() ([]byte, error) {
	if pk == nil || pk.pk == nil {
		return []byte(`""`), nil
	}
	bz, err := pk.pk.MarshalBytes()
	if err != nil {
		return nil, err
	}
	return json.Marshal(hex.EncodeToString(bz))
}

// Value receiver variants implementing jsonpb.JSONPBMarshaler
func (pk minaPubKey) MarshalJSONPB(_ *jsonpb.Marshaler) ([]byte, error) {
	return (&pk).MarshalJSON()
}

// Unmarshal decodes a minaPubKey from a byte slice.
// This method is used for protobuf deserialization.
func (pk *minaPubKey) Unmarshal(dAtA []byte) error {
	if len(dAtA) == 0 {
		// If the data is empty, it could mean the field was not set (for proto3 optional fields)
		// or it's an explicitly empty value. We can set pk.pk to nil.
		pk.pk = nil
		return nil
	}

	// Consistent with Size(), if data is present, it must be PublicKeyTotalByteSize.
	if len(dAtA) != keys.PublicKeyTotalByteSize {
		return fmt.Errorf("incorrect data size for public key: expected %d, got %d", keys.PublicKeyTotalByteSize, len(dAtA))
	}

	if pk.pk == nil {
		pk.pk = new(keys.PublicKey)
	}

	err := pk.pk.UnmarshalBytes(dAtA)
	if err != nil {
		return fmt.Errorf("failed to unmarshal public key: %w", err)
	}
	return nil
}
