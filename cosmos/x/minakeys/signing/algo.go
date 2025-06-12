package signing

import (
	"crypto/sha256"

	"github.com/cosmos/cosmos-sdk/crypto/hd"
	"github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/go-bip39"
	keys "github.com/node101-io/mina-signer-go/keys"
)

// PallasType defines the Pallas signature algorithm type
const PallasType = hd.PubKeyType("pallas")

// Mina signature algorithm implementation
var Mina = pallasAlgo{}

type pallasAlgo struct{}

// Name returns the algorithm name
func (pallasAlgo) Name() hd.PubKeyType {
	return PallasType
}

// Derive derives and returns the Mina private key for the given seed and HD path
func (pallasAlgo) Derive() hd.DeriveFn {
	return func(mnemonic string, bip39Passphrase, hdPath string) ([]byte, error) {
		seed, err := bip39.NewSeedWithErrorChecking(mnemonic, bip39Passphrase)
		if err != nil {
			return nil, err
		}

		// For Mina, we'll use the seed directly with some derivation
		// This is a simplified approach - in production you might want more sophisticated derivation
		masterPriv, ch := hd.ComputeMastersFromSeed(seed)
		if len(hdPath) == 0 {
			return masterPriv[:], nil
		}

		derivedKey, err := hd.DerivePrivateKeyForPath(masterPriv, ch, hdPath)
		if err != nil {
			return nil, err
		}

		return derivedKey, nil
	}
}

// Generate generates a Mina private key from the given bytes
func (pallasAlgo) Generate() hd.GenerateFn {
	return func(bz []byte) types.PrivKey {
		// Use SHA256 to ensure we have the right size for Mina private key
		hash := sha256.Sum256(bz)

		// Create Mina private key from the hash
		sk := keys.NewPrivateKeyFromBytes(hash)

		// Create our custom PrivKey type
		minaPrivKey := &minaPrivKey{sk: &sk}

		return &PrivKey{
			Secret: minaPrivKey,
		}
	}
}
