package ante

import (
	errorsmod "cosmossdk.io/errors"
	"cosmossdk.io/log"
	txsigning "cosmossdk.io/x/tx/signing"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/cosmos-sdk/types/tx/signing"
	"github.com/cosmos/cosmos-sdk/x/auth/ante"

	//auth "github.com/cosmos/cosmos-sdk/x/auth/keeper"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	authsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
	"github.com/cosmos/gogoproto/proto"
	"github.com/node101-io/mina-signer-go/keys"
	minasignature "github.com/node101-io/mina-signer-go/signature"
	minakeys "github.com/node101-io/pulsar/cosmos/x/minakeys/keeper"
	minakeystypes "github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

// ConditionalSigVerifyDecorator chooses between Cosmos and Mina signature verification
type ConditionalSigVerifyDecorator struct {
	cosmosDecorator ante.SigVerificationDecorator
	minaKeeper      minakeys.Keeper
	accountKeeper   ante.AccountKeeper
	signModeHandler *txsigning.HandlerMap
	logger          log.Logger
}

func NewConditionalSigVerifyDecorator(
	cosmosDecorator ante.SigVerificationDecorator,
	minaKeeper minakeys.Keeper,
	accountKeeper ante.AccountKeeper,
	signModeHandler *txsigning.HandlerMap,
	logger log.Logger,
) ConditionalSigVerifyDecorator {
	return ConditionalSigVerifyDecorator{
		cosmosDecorator: cosmosDecorator,
		minaKeeper:      minaKeeper,
		accountKeeper:   accountKeeper,
		signModeHandler: signModeHandler,
		logger:          logger,
	}
}

func (d ConditionalSigVerifyDecorator) AnteHandle(
	ctx sdk.Context,
	tx sdk.Tx,
	simulate bool,
	next sdk.AnteHandler,
) (newCtx sdk.Context, err error) {
	// Check if this is a Mina transaction by looking at extension options
	if d.isMinaTransaction(tx) {
		d.logger.Info("Processing Mina transaction signature verification")
		return d.handleMinaSignatureVerification(ctx, tx, simulate, next)
	}

	// Default to Cosmos signature verification
	d.logger.Info("Processing Cosmos transaction signature verification")
	newCtx, err = d.cosmosDecorator.AnteHandle(ctx, tx, simulate, next)
	if err != nil {
		d.logger.Error("Cosmos signature verification failed", "error", err)
	}

	return newCtx, err
}

// isMinaTransaction checks if the transaction has Mina TxType extension option
func (d ConditionalSigVerifyDecorator) isMinaTransaction(tx sdk.Tx) bool {
	// Check if transaction has extension options
	if txWithExt, ok := tx.(interface{ GetExtensionOptions() []*codectypes.Any }); ok {
		d.logger.Info("Mina transaction detected 1")
		for _, extOption := range txWithExt.GetExtensionOptions() {
			d.logger.Info("Extension option", "extOption", extOption.Value)
			if extOption.GetTypeUrl() == "/cosmos.minakeys.TxTypeExtension" {
				d.logger.Info("Type URL found")
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

// handleMinaSignatureVerification handles Mina signature verification
func (d ConditionalSigVerifyDecorator) handleMinaSignatureVerification(
	ctx sdk.Context,
	tx sdk.Tx,
	simulate bool,
	next sdk.AnteHandler,
) (newCtx sdk.Context, err error) {
	// Skip in simulation mode
	if simulate {
		return next(ctx, tx, simulate)
	}

	sigTx, ok := tx.(authsigning.Tx)
	if !ok {
		return ctx, errorsmod.Wrap(sdkerrors.ErrTxDecode, "invalid transaction type")
	}

	// Get signatures and signers
	sigs, err := sigTx.GetSignaturesV2()
	if err != nil {
		return ctx, err
	}

	signers, err := sigTx.GetSigners()
	if err != nil {
		return ctx, err
	}

	// Verify signature count matches signer count
	if len(sigs) != len(signers) {
		return ctx, errorsmod.Wrapf(
			sdkerrors.ErrUnauthorized,
			"invalid number of signers; expected: %d, got %d",
			len(signers), len(sigs),
		)
	}

	// Verify each signature using Mina cryptography
	for i, sig := range sigs {

		// Get account for sequence number validation
		acc, err := ante.GetSignerAcc(ctx, d.accountKeeper, signers[i])
		if err != nil {
			return ctx, err
		}

		// Check sequence number
		if sig.Sequence != acc.GetSequence() {
			return ctx, errorsmod.Wrapf(
				sdkerrors.ErrWrongSequence,
				"account sequence mismatch, expected %d, got %d",
				acc.GetSequence(), sig.Sequence,
			)
		}

		// Verify Mina signature
		if err := d.verifyMinaSignature(ctx, signers[i], sig, tx); err != nil {
			return ctx, err
		}
	}

	return next(ctx, tx, simulate)
}

// verifyMinaSignature verifies a single Mina signature
func (d ConditionalSigVerifyDecorator) verifyMinaSignature(
	ctx sdk.Context,
	signerAddr sdk.AccAddress,
	sig signing.SignatureV2,
	tx sdk.Tx,
) error {
	// Get the KeyStore entry for this signer
	keyStore, found := d.minaKeeper.GetKeyStore(ctx, signerAddr.String())
	if !found {
		return errorsmod.Wrapf(
			sdkerrors.ErrUnauthorized,
			"no Mina public key registered for address %s",
			signerAddr.String(),
		)
	}
	d.logger.Info("Found KeyStore for signer", "signer", signerAddr.String())

	// Parse Mina public key
	minaPubKey, err := new(keys.PublicKey).FromAddress(keyStore.MinaPublicKey)
	if err != nil {
		return errorsmod.Wrapf(
			sdkerrors.ErrInvalidPubKey,
			"failed to parse Mina public key: %v",
			err,
		)
	}
	d.logger.Info("Successfully parsed Mina public key", "minaPubKey", minaPubKey)

	// Extract signature bytes
	sigBytes, ok := sig.Data.(*signing.SingleSignatureData)
	if !ok {
		return errorsmod.Wrap(sdkerrors.ErrInvalidType, "expected SingleSignatureData")
	}
	d.logger.Info("Successfully extracted signature bytes", "sigBytes", sigBytes)

	// Parse Mina signature
	minaSignature := new(minasignature.Signature)
	if err := minaSignature.UnmarshalBytes(sigBytes.Signature); err != nil {
		return errorsmod.Wrapf(
			sdkerrors.ErrInvalidType,
			"failed to parse Mina signature: %v",
			err,
		)
	}
	d.logger.Info("Successfully parsed Mina signature", "minaSignature", minaSignature)

	// Get account info for signer data (same as Cosmos SDK)
	acc, err := ante.GetSignerAcc(ctx, d.accountKeeper, signerAddr)
	if err != nil {
		return err
	}
	d.logger.Info("Successfully got account info", "acc", acc)

	// Create signer data (same structure as Cosmos SDK)
	genesis := ctx.BlockHeight() == 0
	chainID := ctx.ChainID()
	var accNum uint64
	if !genesis {
		accNum = acc.GetAccountNumber()
	}

	signerData := authsigning.SignerData{
		ChainID:       chainID,
		AccountNumber: accNum,
		Sequence:      acc.GetSequence(),
		// Note: PubKey field is intentionally left nil, same as in signing process
	}

	// Generate the same sign bytes that were used during signing
	// This uses the same logic as SignWithMinaPrivKey in main.go
	signMode := sigBytes.SignMode

	// Generate sign bytes using the same signModeHandler as in signing process
	// Use the same GetSignBytesAdapter as in main.go
	signBytes, err := authsigning.GetSignBytesAdapter(
		ctx, d.signModeHandler, signMode, signerData, tx)
	if err != nil {
		return errorsmod.Wrapf(
			sdkerrors.ErrInvalidType,
			"failed to generate sign bytes: %v",
			err,
		)
	}

	// Convert sign bytes to string (same as signing process)
	// and verify signature with Mina cryptography
	if !minaPubKey.VerifyMessage(minaSignature, string(signBytes), minakeystypes.DevnetNetworkID) {
		return errorsmod.Wrap(
			sdkerrors.ErrUnauthorized,
			"Mina signature verification failed",
		)
	}
	d.logger.Info("✅ Successfully verified Mina signature")

	return nil
}
