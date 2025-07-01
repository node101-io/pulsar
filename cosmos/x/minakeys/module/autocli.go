package minakeys

import (
	autocliv1 "cosmossdk.io/api/cosmos/autocli/v1"

	modulev1 "github.com/node101-io/pulsar/cosmos/api/cosmos/minakeys"
)

// AutoCLIOptions implements the autocli.HasAutoCLIConfig interface.
func (am AppModule) AutoCLIOptions() *autocliv1.ModuleOptions {
	return &autocliv1.ModuleOptions{
		Query: &autocliv1.ServiceCommandDescriptor{
			Service: modulev1.Query_ServiceDesc.ServiceName,
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "Params",
					Use:       "params",
					Short:     "Shows the parameters of the module",
				},
				{
					RpcMethod: "KeyStoreAll",
					Use:       "list-key-store",
					Short:     "List all KeyStore",
				},
				{
					RpcMethod:      "KeyStore",
					Use:            "show-key-store [id]",
					Short:          "Shows a KeyStore",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "index"}},
				},
				{
					RpcMethod: "VoteExtAll",
					Use:       "list-vote-ext",
					Short:     "List all voteExt",
				},
				{
					RpcMethod:      "VoteExt",
					Use:            "show-vote-ext [id]",
					Short:          "Shows a voteExt",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "index"}},
				},
				// this line is used by ignite scaffolding # autocli/query
			},
		},
		Tx: &autocliv1.ServiceCommandDescriptor{
			Service:              modulev1.Msg_ServiceDesc.ServiceName,
			EnhanceCustomCommand: true, // only required if you want to use the custom command
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "UpdateParams",
					Skip:      true, // skipped because authority gated
				},
				{
					RpcMethod:      "CreateKeyStore",
					Use:            "create-key-store [cosmosPublicKey] [minaPublicKey] [cosmosSignature] [minaSignature]",
					Short:          "Create a new KeyStore entry",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "cosmosPublicKey"}, {ProtoField: "minaPublicKey"}, {ProtoField: "cosmosSignature"}, {ProtoField: "minaSignature"}},
				},
				{
					RpcMethod:      "UpdateKeyStore",
					Use:            "update-key-store [cosmosPublicKey] [minaPublicKey] [cosmosSignature] [minaSignature]",
					Short:          "Update an existing KeyStore entry",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "cosmosPublicKey"}, {ProtoField: "minaPublicKey"}, {ProtoField: "cosmosSignature"}, {ProtoField: "minaSignature"}},
				},
				// this line is used by ignite scaffolding # autocli/tx
			},
		},
	}
}
