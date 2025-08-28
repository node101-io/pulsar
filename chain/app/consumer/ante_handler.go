package app

import (
	errorsmod "cosmossdk.io/errors"
	"cosmossdk.io/log"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/cosmos-sdk/x/auth/ante"
	ibcante "github.com/cosmos/ibc-go/v8/modules/core/ante"
	ibckeeper "github.com/cosmos/ibc-go/v8/modules/core/keeper"
	consumerante "github.com/node101-io/pulsar/chain/interchain-security/v5/app/consumer/ante"
	ibcconsumerkeeper "github.com/node101-io/pulsar/chain/interchain-security/v5/x/ccv/consumer/keeper"

	minakeysante "github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/ante"
	minakeyskeeper "github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/keeper"
)

// HandlerOptions extend the SDK's AnteHandler options by requiring the IBC channel keeper.
type HandlerOptions struct {
	ante.HandlerOptions

	IBCKeeper      *ibckeeper.Keeper
	ConsumerKeeper ibcconsumerkeeper.Keeper
	MinaKeeper     minakeyskeeper.Keeper
}

func NewAnteHandler(options HandlerOptions, logger log.Logger) (sdk.AnteHandler, error) {
	if options.AccountKeeper == nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrLogic, "account keeper is required for AnteHandler")
	}
	if options.BankKeeper == nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrLogic, "bank keeper is required for AnteHandler")
	}
	if options.SignModeHandler == nil {
		return nil, errorsmod.Wrap(sdkerrors.ErrLogic, "sign mode handler is required for ante builder")
	}

	sigGasConsumer := options.SigGasConsumer
	if sigGasConsumer == nil {
		sigGasConsumer = ante.DefaultSigVerificationGasConsumer
	}

	anteDecorators := []sdk.AnteDecorator{
		ante.NewSetUpContextDecorator(),
		// Disabled modules decorator for consumer chain
		consumerante.NewDisabledModulesDecorator("/cosmos.evidence", "/cosmos.slashing"),
		ante.NewValidateBasicDecorator(),
		ante.NewTxTimeoutHeightDecorator(),
		ante.NewValidateMemoDecorator(options.AccountKeeper),
		ante.NewConsumeGasForTxSizeDecorator(options.AccountKeeper),
		ante.NewDeductFeeDecorator(options.AccountKeeper, options.BankKeeper, options.FeegrantKeeper, options.TxFeeChecker),
		// SetPubKeyDecorator must be called before all signature verification decorators
		//ante.NewSetPubKeyDecorator(options.AccountKeeper),
		minakeysante.NewConditionalSetPubKeyDecorator(
			ante.NewSetPubKeyDecorator(options.AccountKeeper),
			logger,
		),
		ante.NewValidateSigCountDecorator(options.AccountKeeper),
		ante.NewSigGasConsumeDecorator(options.AccountKeeper, sigGasConsumer),
		//ante.NewSigVerificationDecorator(options.AccountKeeper, options.SignModeHandler),
		minakeysante.NewConditionalSigVerifyDecorator(
			ante.NewSigVerificationDecorator(options.AccountKeeper, options.SignModeHandler),
			options.MinaKeeper,
			options.AccountKeeper,
			options.SignModeHandler,
			logger,
		),
		ante.NewIncrementSequenceDecorator(options.AccountKeeper),
		ibcante.NewRedundantRelayDecorator(options.IBCKeeper),
		// MinaKeys Checker
		minakeysante.NewMinaRegistrationDecorator(options.MinaKeeper, options.AccountKeeper),
	}

	// Consumer ante decorator that rejects all non-IBC messages until the CCV channel is established
	//anteDecorators = append(anteDecorators, consumerante.NewMsgFilterDecorator(options.ConsumerKeeper))

	return sdk.ChainAnteDecorators(anteDecorators...), nil
}
