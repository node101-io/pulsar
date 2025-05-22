package types

import (
	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
)

type SecondaryKey struct {
	SecretKey *mina.SecretKey
	PublicKey *mina.PublicKey
}
