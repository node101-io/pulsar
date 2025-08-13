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
					RpcMethod: "DepositAmountMapAll",
					Use:       "list-deposit-amount-map",
					Short:     "List all DepositAmountMap",
				},
				{
					RpcMethod:      "DepositAmountMap",
					Use:            "show-deposit-amount-map [address]",
					Short:          "Shows a DepositAmountMap by address",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "address"}},
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
					RpcMethod:      "DepositMina",
					Use:            "deposit-mina [amount] [recipient]",
					Short:          "Deposit Mina tokens to the bridge",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "amount"}, {ProtoField: "recipient"}},
				},
			},
		},
	}
}
