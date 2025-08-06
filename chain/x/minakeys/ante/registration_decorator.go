package ante

import (
	"fmt"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	authsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
	"github.com/cosmos/interchain-security/v5/x/minakeys/keeper"
	minakeystypes "github.com/cosmos/interchain-security/v5/x/minakeys/types"
)

type MinaRegistrationDecorator struct {
	minaKeeper    keeper.Keeper
	accountKeeper minakeystypes.AccountKeeper
}

func NewMinaRegistrationDecorator(minaKeeper keeper.Keeper, accountKeeper minakeystypes.AccountKeeper) MinaRegistrationDecorator {
	return MinaRegistrationDecorator{
		minaKeeper:    minaKeeper,
		accountKeeper: accountKeeper,
	}
}

func (mrd MinaRegistrationDecorator) AnteHandle(ctx sdk.Context, tx sdk.Tx, simulate bool, next sdk.AnteHandler) (newCtx sdk.Context, err error) {
	// Skip the check in simulate mode
	if simulate {
		return next(ctx, tx, simulate)
	}

	// Debug: Is the decorator working?
	fmt.Printf("🔍 MinaRegistrationDecorator: Processing transaction with %d messages\n", len(tx.GetMsgs()))

	// COSMOS SDK STANDARD METHOD: Cast the transaction to authsigning.Tx
	sigTx, ok := tx.(authsigning.Tx)
	if !ok {
		return ctx, errorsmod.Wrap(sdkerrors.ErrTxDecode, "invalid transaction type")
	}

	// GetSigners() method - same as SigVerificationDecorator
	signers, err := sigTx.GetSigners()
	if err != nil {
		return ctx, err
	}

	fmt.Printf("🔍 Found %d signers from transaction: %v\n", len(signers), signers)

	// Check if there are any MinaKey messages
	hasMinaKeyMessage := false
	for _, msg := range tx.GetMsgs() {
		if mrd.isKeyStoreMsg(msg) {
			fmt.Printf("✅ Found KeyStore message: %T\n", msg)
			hasMinaKeyMessage = true
		}
	}

	// If there is only one MinaKey message, skip the verification
	if hasMinaKeyMessage && len(tx.GetMsgs()) == 1 {
		fmt.Printf("✅ Only MinaKey messages found, skipping verification\n")
		return next(ctx, tx, simulate)
	}

	// For each signer, check if they are registered in Mina keystore
	for _, signerAddr := range signers {
		signerStr := sdk.AccAddress(signerAddr).String()
		fmt.Printf("🔍 Checking signer: %s\n", signerStr)

		// Check if the public key is registered in Mina keystore
		_, found := mrd.minaKeeper.GetKeyStore(ctx, signerStr)
		if !found {
			fmt.Printf("❌ NOT FOUND! Signer %s not registered in Mina keystore\n", signerStr)
			return ctx, errorsmod.Wrapf(
				sdkerrors.ErrUnauthorized,
				"sender address %s is not registered in Mina keystore. Please register your Mina public key first",
				signerStr,
			)
		} else {
			fmt.Printf("✅ FOUND! Signer %s is registered in Mina keystore\n", signerStr)
		}
	}

	return next(ctx, tx, simulate)
}

// Check if the message is a KeyStore message
func (mrd MinaRegistrationDecorator) isKeyStoreMsg(msg sdk.Msg) bool {
	switch msg.(type) {
	case *minakeystypes.MsgCreateKeyStore, *minakeystypes.MsgUpdateKeyStore:
		return true
	default:
		return false
	}
}
