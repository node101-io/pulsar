package types

import (
	"github.com/node101-io/mina-signer-go/keys"
)

type SecondaryKey struct {
	SecretKey *keys.PrivateKey
	PublicKey *keys.PublicKey
}

const DevnetNetworkID = "pulsar-devnet"
