package bridge

import (
	autocliv1 "cosmossdk.io/api/cosmos/autocli/v1"
)

// AutoCLIOptions implements the autocli.HasAutoCLIConfig interface.
func (am AppModule) AutoCLIOptions() *autocliv1.ModuleOptions {
	return &autocliv1.ModuleOptions{
		Query: &autocliv1.ServiceCommandDescriptor{
			Service: "interchain_security.bridge.Query",
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "Params",
					Use:       "params",
					Short:     "Shows the parameters of the module",
				},
				{
					RpcMethod: "TestQuery",
					Use:       "test-query",
					Short:     "Returns test string 'node101'",
				},
				{
					RpcMethod: "BridgeState",
					Use:       "bridge-state",
					Short:     "Shows the complete bridge state",
				},
			},
		},
		Tx: &autocliv1.ServiceCommandDescriptor{
			Service:              "interchain_security.bridge.Msg",
			EnhanceCustomCommand: true,
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "UpdateParams",
					Skip:      true, // skipped because authority gated
				},
				{
					RpcMethod: "ResolveActions",
					Use:       "resolve-actions [next-block-height] [merkle-witness] [actions-json-file]",
					Short:     "Resolve actions from Mina smart contract",
					Long:      "Resolve and process a list of actions from the Mina smart contract. Actions should be provided as a JSON file.",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{
						{ProtoField: "next_block_height"},
						{ProtoField: "merkle_witness"},
					},
				},
			},
		},
	}
}
