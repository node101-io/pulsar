package signing

import (
	"encoding/hex"
	fmt "fmt"
	"math/big"

	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/gogoproto/jsonpb"
	keys "github.com/node101-io/mina-signer-go/keys"
	poseidonbigint "github.com/node101-io/mina-signer-go/poseidonbigint"
	signature "github.com/node101-io/mina-signer-go/signature"
)

type minaPrivKey struct {
	sk *keys.PrivateKey
}

func (privKey *PrivKey) String() string {
	bytes, err := privKey.Secret.sk.MarshalBytes()
	if err != nil {
		return ""
	}

	return hex.EncodeToString(bytes)
}

func (privKey *PrivKey) Bytes() []byte {
	bytes, err := privKey.Secret.sk.MarshalBytes()
	if err != nil {
		return nil
	}

	return bytes
}

func (privKey *PrivKey) Sign(msg []byte) ([]byte, error) {
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

	// Sign the generated hash input on the DevNet network.
	// The `mina-signer-go` library expects the network ID as a string in the second parameter.
	var signatureObject *signature.Signature
	signatureObject, err := privKey.Secret.sk.Sign(hashInput, DevnetNetworkID)
	if err != nil {
		return nil, fmt.Errorf("failed to sign message: %w", err)
	}

	// Convert the signature to a byte slice.
	signedBytes, err := signatureObject.MarshalBytes()
	if err != nil {
		return nil, fmt.Errorf("failed to serialize signature: %w", err)
	}

	return signedBytes, nil
}

func (privKey *PrivKey) PubKey() cryptotypes.PubKey {
	pubKey := privKey.Secret.sk.ToPublicKey()

	var minaPubKey minaPubKey
	minaPubKey.pk = &pubKey

	return &PubKey{
		Key: &minaPubKey,
	}
}

func (privKey *PrivKey) Equals(other cryptotypes.LedgerPrivKey) bool {
	sk2, ok := other.(*PrivKey)
	if !ok {
		return false
	}

	return privKey.Secret.sk.Equal(*sk2.Secret.sk)
}

func (privKey *PrivKey) Type() string {
	return KeyType
}

func (privKey *minaPrivKey) Size() int {
	if privKey.sk == nil {
		return 0
	}

	return keys.PrivateKeyByteSize
}

func (privKey *minaPrivKey) MarshalTo(dAtA []byte) (int, error) {
	if privKey.sk == nil {
		return 0, nil // Nothing to marshal
	}

	keyBytes, err := privKey.sk.MarshalBytes()
	if err != nil {
		return 0, fmt.Errorf("failed to marshal private key: %w", err)
	}

	// Ensure the marshaled bytes match the expected size.
	// This is a sanity check, as Size() should already reflect this.
	if len(keyBytes) != keys.PrivateKeyByteSize {
		return 0, fmt.Errorf("marshaled private key size mismatch: got %d, want %d", len(keyBytes), keys.PrivateKeyByteSize)
	}

	if len(dAtA) < keys.PrivateKeyByteSize {
		return 0, fmt.Errorf("destination buffer for private key too small: got %d, want at least %d", len(dAtA), keys.PrivateKeyByteSize)
	}

	copy(dAtA, keyBytes)
	return keys.PrivateKeyByteSize, nil
}

// MarshalJSON omits private key bytes from JSON output.
func (priv *minaPrivKey) MarshalJSON() ([]byte, error) {
	return []byte(`""`), nil
}

func (priv minaPrivKey) MarshalJSONPB(_ *jsonpb.Marshaler) ([]byte, error) {
	return (&priv).MarshalJSON()
}

func (privKey *minaPrivKey) Unmarshal(dAtA []byte) error {
	if len(dAtA) == 0 {
		// If the data is empty, it could mean the field was not set (for proto3 optional fields)
		// or it's an explicitly empty value. We can set privKey.sk to nil.
		privKey.sk = nil
		return nil
	}

	// Consistent with Size(), if data is present, it must be PrivateKeyByteSize.
	if len(dAtA) != keys.PrivateKeyByteSize {
		return fmt.Errorf("incorrect data size for private key: expected %d, got %d", keys.PrivateKeyByteSize, len(dAtA))
	}

	if privKey.sk == nil {
		privKey.sk = new(keys.PrivateKey)
	}

	err := privKey.sk.UnmarshalBytes(dAtA)
	if err != nil {
		return fmt.Errorf("failed to unmarshal private key: %w", err)
	}
	return nil
}
