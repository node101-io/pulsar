package types_test

import (
	"testing"

	"github.com/node101-io/pulsar/chain/x/minakeys/types"
	"github.com/stretchr/testify/require"
)

func TestGenesisState_Validate(t *testing.T) {
	tests := []struct {
		desc     string
		genState *types.GenesisState
		valid    bool
	}{
		{
			desc:     "default is valid",
			genState: types.DefaultGenesis(),
			valid:    true,
		},
		{
			desc: "valid genesis state",
			genState: &types.GenesisState{

				KeyStoreList: []types.KeyStore{
					{
						CosmosPublicKey: "0",
					},
					{
						CosmosPublicKey: "1",
					},
				},
				VoteExtList: []types.VoteExt{
					{
						Index: "0",
					},
					{
						Index: "1",
					},
				},
				// this line is used by starport scaffolding # types/genesis/validField
			},
			valid: true,
		},
		{
			desc: "duplicated keyStore",
			genState: &types.GenesisState{
				KeyStoreList: []types.KeyStore{
					{
						CosmosPublicKey: "0",
					},
					{
						CosmosPublicKey: "0",
					},
				},
			},
			valid: false,
		},
		{
			desc: "duplicated voteExt",
			genState: &types.GenesisState{
				VoteExtList: []types.VoteExt{
					{
						Index: "0",
					},
					{
						Index: "0",
					},
				},
			},
			valid: false,
		},
		// this line is used by starport scaffolding # types/genesis/testcase
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			err := tc.genState.Validate()
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
