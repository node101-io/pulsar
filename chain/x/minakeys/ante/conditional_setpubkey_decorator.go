package ante

import (
	"cosmossdk.io/log"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/x/auth/ante"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/gogoproto/proto"
	minakeystypes "github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/types"
)

// ConditionalSetPubKeyDecorator chooses between Cosmos and Mina pubkey setting
type ConditionalSetPubKeyDecorator struct {
	cosmosDecorator ante.SetPubKeyDecorator
	logger          log.Logger
}

func NewConditionalSetPubKeyDecorator(
	cosmosDecorator ante.SetPubKeyDecorator,
	logger log.Logger,
) ConditionalSetPubKeyDecorator {
	return ConditionalSetPubKeyDecorator{
		cosmosDecorator: cosmosDecorator,
		logger:          logger,
	}
}

func (d ConditionalSetPubKeyDecorator) AnteHandle(
	ctx sdk.Context,
	tx sdk.Tx,
	simulate bool,
	next sdk.AnteHandler,
) (newCtx sdk.Context, err error) {
	// Check if this is a Mina transaction by looking at extension options
	if d.isMinaTransaction(tx) {
		d.logger.Info("Processing Mina transaction pubkey handling - skipping pubkey setting")
		// For Mina transactions, skip pubkey setting since keys are already registered in KeyStore
		return next(ctx, tx, simulate)
	}

	// Default to Cosmos pubkey setting
	d.logger.Info("Processing Cosmos transaction pubkey setting")
	newCtx, err = d.cosmosDecorator.AnteHandle(ctx, tx, simulate, next)
	if err != nil {
		d.logger.Error("Cosmos pubkey setting failed", "error", err)
	}

	return newCtx, err
}

// isMinaTransaction checks if the transaction has Mina TxType extension option
func (d ConditionalSetPubKeyDecorator) isMinaTransaction(tx sdk.Tx) bool {
	// Check if transaction has extension options
	if txWithExt, ok := tx.(interface{ GetExtensionOptions() []*codectypes.Any }); ok {
		d.logger.Info("Checking for Mina transaction extension options")
		for _, extOption := range txWithExt.GetExtensionOptions() {
			d.logger.Info("Extension option", "extOption", extOption.Value)
			if extOption.GetTypeUrl() == "/cosmos.minakeys.TxTypeExtension" {
				d.logger.Info("TxType extension found")
				var txTypeExt minakeystypes.TxTypeExtension
				if err := proto.Unmarshal(extOption.GetValue(), &txTypeExt); err == nil {
					d.logger.Info("Unmarshalled txTypeExt", "txTypeExt", txTypeExt)
					return txTypeExt.TxType == minakeystypes.MINA_TX
				}
			}
		}
	} else {
		d.logger.Info("No extension options found", "tx", tx)
	}

	return false
}
