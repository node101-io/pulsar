package keeper

import (
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

// processDepositAction processes a deposit action
// Returns true if action was approved and processed, false if ignored
func (k Keeper) processDepositAction(ctx sdk.Context, action types.PulsarAction, approvedActions *[]types.PulsarAction, approvedHash *string) bool {

	allKeyStoresWithSDKCtx, found := k.minakeysKeeper.GetKeyStore(ctx, action.PublicKey)
	if !found {
		ctx.Logger().Error("processDepositAction: Failed to get key store", "error", "key not found")
	}
	ctx.Logger().Info("processDepositAction:Key store found",
		"key_store", allKeyStoresWithSDKCtx.Creator)

	// Check if Mina public key is registered
	if !k.IsMinaPublicKeyRegistered(ctx, action.PublicKey) {
		ctx.Logger().Info("Ignoring deposit: Mina public key not registered",
			"mina_public_key", action.PublicKey,
			"amount", action.Amount.String())
		return false
	}
	ctx.Logger().Info("processDepositAction: Mina public key is registered",
		"mina_public_key", action.PublicKey)

	// Convert Mina public key to Cosmos address for minting
	cosmosAddr, err := k.MinaPublicKeyToCosmosAddress(ctx, action.PublicKey)
	if err != nil {
		ctx.Logger().Error("Failed to convert Mina public key to Cosmos address",
			"mina_public_key", action.PublicKey,
			"error", err)
		return false
	}
	ctx.Logger().Info("Mina public key converted to Cosmos address",
		"mina_public_key", action.PublicKey,
		"cosmos_address", cosmosAddr.String())

	// Mint pMINA to the account
	if err := k.MintPMina(ctx, cosmosAddr, action.Amount); err != nil {
		ctx.Logger().Error("Failed to mint pMINA for deposit",
			"mina_public_key", action.PublicKey,
			"cosmos_address", cosmosAddr.String(),
			"amount", action.Amount.String(),
			"error", err)
		return false
	}

	// Add to approved actions and update hash
	*approvedActions = append(*approvedActions, action)
	newHash, err := k.UpdateHash(ctx, *approvedHash, action)
	if err != nil {
		ctx.Logger().Error("Failed to update hash", "error", err)
		return false
	}
	*approvedHash = newHash

	// Emit event
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			types.EventTypeDepositProcessed,
			sdk.NewAttribute(types.AttributeKeyPublicKey, action.PublicKey),
			sdk.NewAttribute(types.AttributeKeyAmount, action.Amount.String()),
			sdk.NewAttribute(types.AttributeKeyCosmosAddress, action.CosmosAddress),
			sdk.NewAttribute(types.AttributeKeyCosmosSignature, action.CosmosSignature),
		),
	)

	ctx.Logger().Info("Deposit action processed successfully",
		"mina_public_key", action.PublicKey,
		"cosmos_address", cosmosAddr.String(),
		"amount", action.Amount.String())

	return true
}

// processWithdrawalAction processes a withdrawal action
// Returns true if action was approved and processed, false if ignored
func (k Keeper) processWithdrawalAction(ctx sdk.Context, action types.PulsarAction, approvedActions *[]types.PulsarAction, approvedHash *string) bool {
	// Check if user has sufficient withdrawal balance
	currentBalance := k.GetWithdrawalBalance(ctx, action.PublicKey)

	if currentBalance.LT(action.Amount) {
		ctx.Logger().Info("Ignoring withdrawal: insufficient balance",
			"mina_public_key", action.PublicKey,
			"requested_amount", action.Amount.String(),
			"current_balance", currentBalance.String())
		return false
	}

	// Decrease withdrawal balance
	newBalance := currentBalance.Sub(action.Amount)
	k.SetWithdrawalBalance(ctx, action.PublicKey, newBalance)

	// Add to approved actions and update hash
	*approvedActions = append(*approvedActions, action)
	newHash, err := k.UpdateHash(ctx, *approvedHash, action)
	if err != nil {
		ctx.Logger().Error("Failed to update hash", "error", err)
		return false
	}
	*approvedHash = newHash

	// Emit event
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			types.EventTypeWithdrawalProcessed,
			sdk.NewAttribute(types.AttributeKeyPublicKey, action.PublicKey),
			sdk.NewAttribute(types.AttributeKeyAmount, action.Amount.String()),
			sdk.NewAttribute(types.AttributeKeyBalance, newBalance.String()),
			sdk.NewAttribute(types.AttributeKeyCosmosAddress, action.CosmosAddress),
			sdk.NewAttribute(types.AttributeKeyCosmosSignature, action.CosmosSignature),
		),
	)

	ctx.Logger().Info("Withdrawal action processed successfully",
		"mina_public_key", action.PublicKey,
		"amount", action.Amount.String(),
		"new_balance", newBalance.String())

	return true
}

// processSettlementAction processes a settlement action
// Settlement actions are always approved
func (k Keeper) processSettlementAction(ctx sdk.Context, action types.PulsarAction, approvedActions *[]types.PulsarAction, approvedHash *string) {
	// Settlement actions are always approved - just add to approved actions and update hash
	*approvedActions = append(*approvedActions, action)
	newHash, err := k.UpdateHash(ctx, *approvedHash, action)
	if err != nil {
		ctx.Logger().Error("Failed to update hash", "error", err)
		return
	}
	*approvedHash = newHash

	// Emit event
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			types.EventTypeSettlementProcessed,
			sdk.NewAttribute(types.AttributeKeyPublicKey, action.PublicKey),
			sdk.NewAttribute(types.AttributeKeyAmount, action.Amount.String()),
			sdk.NewAttribute(types.AttributeKeyCosmosAddress, action.CosmosAddress),
			sdk.NewAttribute(types.AttributeKeyCosmosSignature, action.CosmosSignature),
		),
	)

	ctx.Logger().Info("Settlement action processed successfully",
		"mina_public_key", action.PublicKey,
		"amount", action.Amount.String())
}
