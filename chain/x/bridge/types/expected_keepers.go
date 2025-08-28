package types

import (
	"context"

	sdk "github.com/cosmos/cosmos-sdk/types"
	minakeys "github.com/node101-io/pulsar/chain/x/minakeys/types"
)

// AccountKeeper defines the expected interface for the Account module.
type AccountKeeper interface {
	GetAccount(context.Context, sdk.AccAddress) sdk.AccountI // only used for simulation
	// Methods imported from account should be defined here
}

// BankKeeper defines the expected interface for the Bank module.
type BankKeeper interface {
	SpendableCoins(context.Context, sdk.AccAddress) sdk.Coins
	// Methods for minting and burning tokens
	MintCoins(ctx context.Context, moduleName string, amt sdk.Coins) error
	BurnCoins(ctx context.Context, moduleName string, amt sdk.Coins) error
	// Methods for transferring tokens
	SendCoinsFromModuleToAccount(ctx context.Context, senderModule string, recipientAddr sdk.AccAddress, amt sdk.Coins) error
	SendCoinsFromAccountToModule(ctx context.Context, senderAddr sdk.AccAddress, recipientModule string, amt sdk.Coins) error
	// Methods for checking balances
	GetBalance(ctx context.Context, addr sdk.AccAddress, denom string) sdk.Coin
	GetAllBalances(ctx context.Context, addr sdk.AccAddress) sdk.Coins
}

// ParamSubspace defines the expected Subspace interface for parameters.
type ParamSubspace interface {
	Get(context.Context, []byte, interface{})
	Set(context.Context, []byte, interface{})
}

// MinakeysKeeper defines the expected interface for the Minakeys module.
type MinakeysKeeper interface {
	GetKeyStore(ctx context.Context, index string) (val minakeys.KeyStore, found bool)
}
