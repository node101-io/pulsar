package keeper

import (
	"fmt"

	"cosmossdk.io/core/store"
	"cosmossdk.io/log"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	types "github.com/node101-io/pulsar/chain/interchain-security/v5/x/bridge/types"
)

type (
	Keeper struct {
		cdc          codec.BinaryCodec
		storeService store.KVStoreService
		logger       log.Logger

		// the address capable of executing a MsgUpdateParams message. Typically, this
		// should be the x/gov module account.
		authority string

		// Bank keeper for minting/burning operations
		bankKeeper     types.BankKeeper
		accountKeeper  types.AccountKeeper
		minakeysKeeper types.MinakeysKeeper
	}
)

func NewKeeper(
	cdc codec.BinaryCodec,
	storeService store.KVStoreService,
	logger log.Logger,
	authority string,
	bankKeeper types.BankKeeper,
	accountKeeper types.AccountKeeper,
	minakeysKeeper types.MinakeysKeeper,
) Keeper {
	if _, err := sdk.AccAddressFromBech32(authority); err != nil {
		panic(fmt.Sprintf("invalid authority address: %s", authority))
	}

	return Keeper{
		cdc:            cdc,
		storeService:   storeService,
		authority:      authority,
		logger:         logger,
		bankKeeper:     bankKeeper,
		accountKeeper:  accountKeeper,
		minakeysKeeper: minakeysKeeper,
	}
}

// GetAuthority returns the module's authority.
func (k Keeper) GetAuthority() string {
	return k.authority
}

// Logger returns a module-specific logger.
func (k Keeper) Logger() log.Logger {
	return k.logger.With("module", fmt.Sprintf("x/%s", types.ModuleName))
}

// InitGenesis initializes the module's state from a genesis state.
func (k Keeper) InitGenesis(ctx sdk.Context, genState types.GenesisState) {
	// Set params
	if err := k.SetParams(ctx, genState.Params); err != nil {
		panic(err)
	}

	// Initialize bridge state
	bridgeState := genState.BridgeState

	// Set withdrawal balances
	for _, wb := range bridgeState.WithdrawalBalances {
		k.SetWithdrawalBalance(ctx, wb.PublicKey, wb.Amount)
	}

	// Set reward balances
	for _, rb := range bridgeState.RewardBalances {
		k.SetRewardBalance(ctx, rb.PublicKey, rb.Amount)
	}

	// Set approved actions
	k.SetApprovedActions(ctx, bridgeState.ApprovedActions)

	// Set hashes
	if len(bridgeState.ApprovedActions) > 0 {
		k.SetApprovedActionHash(ctx, bridgeState.ApprovedActionHash)
		k.SetAllActionHash(ctx, bridgeState.AllActionHash)
	} else {
		k.SetApprovedActionHash(ctx, k.InitializeHash())
		k.SetAllActionHash(ctx, k.InitializeHash())
	}

	// Set settled block height
	k.SetSettledBlockHeight(ctx, bridgeState.SettledBlockHeight)
}

// ExportGenesis returns the module's exported genesis state.
func (k Keeper) ExportGenesis(ctx sdk.Context) *types.GenesisState {
	params := k.GetParams(ctx)

	return &types.GenesisState{
		Params: params,
		BridgeState: types.BridgeState{
			WithdrawalBalances: k.GetAllWithdrawalBalances(ctx),
			RewardBalances:     k.GetAllRewardBalances(ctx),
			ApprovedActions:    k.GetApprovedActions(ctx),
			ApprovedActionHash: k.GetApprovedActionHash(ctx),
			AllActionHash:      k.GetAllActionHash(ctx),
			SettledBlockHeight: k.GetSettledBlockHeight(ctx),
		},
	}
}
