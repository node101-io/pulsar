package types

import (
	"fmt"
)

// DefaultIndex is the default global index
const DefaultIndex uint64 = 1

// DefaultGenesis returns the default genesis state
func DefaultGenesis() *GenesisState {
	return &GenesisState{
		KeyStoreList: []KeyStore{},
		VoteExtList:  []VoteExt{},
		// this line is used by starport scaffolding # genesis/types/default
		Params: DefaultParams(),
	}
}

// Validate performs basic genesis state validation returning an error upon any
// failure.
func (gs GenesisState) Validate() error {
	// Check for duplicated index in keyStore
	keyStoreIndexMap := make(map[string]struct{})

	for _, elem := range gs.KeyStoreList {
		index := string(KeyStoreKey(elem.CosmosPublicKey))
		if _, ok := keyStoreIndexMap[index]; ok {
			return fmt.Errorf("duplicated index for keyStore")
		}
		keyStoreIndexMap[index] = struct{}{}
	}
	// Check for duplicated index in voteExt
	voteExtIndexMap := make(map[string]struct{})

	for _, elem := range gs.VoteExtList {
		index := string(VoteExtKey(elem.Index))
		if _, ok := voteExtIndexMap[index]; ok {
			return fmt.Errorf("duplicated index for voteExt")
		}
		voteExtIndexMap[index] = struct{}{}
	}
	// this line is used by starport scaffolding # genesis/types/validate

	return gs.Params.Validate()
}
