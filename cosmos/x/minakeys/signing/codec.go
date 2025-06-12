package signing

import (
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
)

// RegisterInterfaces registers the minakeys crypto interfaces with the interface registry
func RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	registry.RegisterImplementations(
		(*cryptotypes.PubKey)(nil),
		&PubKey{},
	)

	registry.RegisterImplementations(
		(*cryptotypes.PrivKey)(nil),
		&PrivKey{},
	)
}
