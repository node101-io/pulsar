package minakeys

import (
	"math/rand"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/module"
	simtypes "github.com/cosmos/cosmos-sdk/types/simulation"
	"github.com/cosmos/cosmos-sdk/x/simulation"

	"github.com/node101-io/pulsar/cosmos/testutil/sample"
	minakeyssimulation "github.com/node101-io/pulsar/cosmos/x/minakeys/simulation"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

// avoid unused import issue
var (
	_ = minakeyssimulation.FindAccount
	_ = rand.Rand{}
	_ = sample.AccAddress
	_ = sdk.AccAddress{}
	_ = simulation.MsgEntryKind
)

const (
	opWeightMsgCreateKeyStore = "op_weight_msg_key_store"
	// TODO: Determine the simulation weight value
	defaultWeightMsgCreateKeyStore int = 100

	opWeightMsgUpdateKeyStore = "op_weight_msg_key_store"
	// TODO: Determine the simulation weight value
	defaultWeightMsgUpdateKeyStore int = 100

	// this line is used by starport scaffolding # simapp/module/const
)

// GenerateGenesisState creates a randomized GenState of the module.
func (AppModule) GenerateGenesisState(simState *module.SimulationState) {
	accs := make([]string, len(simState.Accounts))
	for i, acc := range simState.Accounts {
		accs[i] = acc.Address.String()
	}
	minakeysGenesis := types.GenesisState{
		Params: types.DefaultParams(),
		KeyStoreList: []types.KeyStore{
			{
				Creator:         sample.AccAddress(),
				CosmosPublicKey: "0",
			},
			{
				Creator:         sample.AccAddress(),
				CosmosPublicKey: "1",
			},
		},
		// this line is used by starport scaffolding # simapp/module/genesisState
	}
	simState.GenState[types.ModuleName] = simState.Cdc.MustMarshalJSON(&minakeysGenesis)
}

// RegisterStoreDecoder registers a decoder.
func (am AppModule) RegisterStoreDecoder(_ simtypes.StoreDecoderRegistry) {}

// WeightedOperations returns the all the gov module operations with their respective weights.
func (am AppModule) WeightedOperations(simState module.SimulationState) []simtypes.WeightedOperation {
	operations := make([]simtypes.WeightedOperation, 0)

	var weightMsgCreateKeyStore int
	simState.AppParams.GetOrGenerate(opWeightMsgCreateKeyStore, &weightMsgCreateKeyStore, nil,
		func(_ *rand.Rand) {
			weightMsgCreateKeyStore = defaultWeightMsgCreateKeyStore
		},
	)
	operations = append(operations, simulation.NewWeightedOperation(
		weightMsgCreateKeyStore,
		minakeyssimulation.SimulateMsgCreateKeyStore(am.accountKeeper, am.bankKeeper, am.keeper),
	))

	var weightMsgUpdateKeyStore int
	simState.AppParams.GetOrGenerate(opWeightMsgUpdateKeyStore, &weightMsgUpdateKeyStore, nil,
		func(_ *rand.Rand) {
			weightMsgUpdateKeyStore = defaultWeightMsgUpdateKeyStore
		},
	)
	operations = append(operations, simulation.NewWeightedOperation(
		weightMsgUpdateKeyStore,
		minakeyssimulation.SimulateMsgUpdateKeyStore(am.accountKeeper, am.bankKeeper, am.keeper),
	))

	// this line is used by starport scaffolding # simapp/module/operation

	return operations
}

// ProposalMsgs returns msgs used for governance proposals for simulations.
func (am AppModule) ProposalMsgs(simState module.SimulationState) []simtypes.WeightedProposalMsg {
	return []simtypes.WeightedProposalMsg{
		simulation.NewWeightedProposalMsg(
			opWeightMsgCreateKeyStore,
			defaultWeightMsgCreateKeyStore,
			func(r *rand.Rand, ctx sdk.Context, accs []simtypes.Account) sdk.Msg {
				minakeyssimulation.SimulateMsgCreateKeyStore(am.accountKeeper, am.bankKeeper, am.keeper)
				return nil
			},
		),
		simulation.NewWeightedProposalMsg(
			opWeightMsgUpdateKeyStore,
			defaultWeightMsgUpdateKeyStore,
			func(r *rand.Rand, ctx sdk.Context, accs []simtypes.Account) sdk.Msg {
				minakeyssimulation.SimulateMsgUpdateKeyStore(am.accountKeeper, am.bankKeeper, am.keeper)
				return nil
			},
		),
		// this line is used by starport scaffolding # simapp/module/OpMsg
	}
}
