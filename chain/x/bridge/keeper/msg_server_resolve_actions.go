package keeper

import (
	"context"
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

// ResolveActions handles the MsgResolveActions message
func (k msgServer) ResolveActions(goCtx context.Context, msg *types.MsgResolveActions) (*types.MsgResolveActionsResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	allKeyStoresWithSDKCtx, found := k.minakeysKeeper.GetKeyStore(ctx, msg.Actions[0].PublicKey)
	if !found {
		ctx.Logger().Error("ResolveActions: Failed to get key store", "error", "key not found")
	}
	ctx.Logger().Info("ResolveActions:Key store found",
		"key_store", allKeyStoresWithSDKCtx.Creator)

	ctx.Logger().Info("ResolveActions: All key stores with SDK context",
		"all_key_stores", allKeyStoresWithSDKCtx.Creator)

	ctx.Logger().Info("ResolveActions transaction started",
		"creator", msg.Creator,
		"actions_count", len(msg.Actions),
		"next_block_height", msg.NextBlockHeight,
		"minakeys_keeper", k.Keeper.minakeysKeeper)

	// Validate input parameters
	if err := msg.ValidateBasic(); err != nil {
		return nil, err
	}

	ctx.Logger().Info("ResolveActions transaction started",
		"creator", msg.Creator,
		"actions_count", len(msg.Actions),
		"next_block_height", msg.NextBlockHeight)

	// Get current settled block height
	settledHeight := k.Keeper.GetSettledBlockHeight(ctx)

	ctx.Logger().Info("Current state",
		"settled_height", settledHeight,
		"next_height", msg.NextBlockHeight)

	// Verify action list with signer node
	isValidList, err := k.Keeper.VerifyActionList(ctx, settledHeight, msg.Actions, msg.NextBlockHeight, msg.MerkleWitness)
	if err != nil {
		ctx.Logger().Error("Signer verification failed", "error", err)
		return nil, err
	}
	ctx.Logger().Info("Action list verified successfully", "is_valid_list", isValidList)
	ctx.Logger().Info("Length of is_valid_list", "length", len(isValidList))

	minLen := len(isValidList)
	if len(msg.Actions) < minLen {
		minLen = len(msg.Actions)
	}

	validActionsList := make([]types.PulsarAction, 0, minLen)
	for i := 0; i < minLen; i++ {
		if isValidList[i] {
			validActionsList = append(validActionsList, msg.Actions[i])
		} else {
			a := msg.Actions[i]
			ctx.Logger().Warn("Invalid action filtered out",
				"index", i,
				"action_public_key", a.PublicKey,
				"action_type", a.ActionType,
				"action_amount", a.Amount.String(),
				"action_cosmos_address", a.CosmosAddress,
				"action_cosmos_signature", a.CosmosSignature,
			)
		}
	}

	ctx.Logger().Info("Successfully removed invalid actions", "valid_actions", validActionsList)

	// Process actions
	result, err := k.Keeper.ProcessActions(ctx, validActionsList, msg.NextBlockHeight)
	if err != nil {
		ctx.Logger().Error("Failed to process actions", "error", err)
		return nil, err
	}

	ctx.Logger().Info("Successfully processed actions", "valid_actions", validActionsList)

	// Update settled block height
	k.Keeper.SetSettledBlockHeight(ctx, msg.NextBlockHeight)

	ctx.Logger().Info("Successfully set settled block height", "block_height", msg.NextBlockHeight)

	// Add reward to prover (creator of the message)
	if err := k.Keeper.AddProverReward(ctx, msg.Creator); err != nil {
		ctx.Logger().Error("Failed to add prover reward", "error", err)
		return nil, err
	}

	ctx.Logger().Info("Successfully added prover reward", "prover", msg.Creator)

	// Emit main event
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			types.EventTypeResolveActions,
			sdk.NewAttribute(types.AttributeKeyProver, msg.Creator),
			sdk.NewAttribute(types.AttributeKeyProcessedCount, fmt.Sprintf("%d", result.ProcessedCount)),
			sdk.NewAttribute(types.AttributeKeyApprovedCount, fmt.Sprintf("%d", result.ApprovedCount)),
			sdk.NewAttribute(types.AttributeKeyIgnoredCount, fmt.Sprintf("%d", result.IgnoredCount)),
			sdk.NewAttribute(types.AttributeKeyBlockHeight, fmt.Sprintf("%d", msg.NextBlockHeight)),
		),
	)

	ctx.Logger().Info("ResolveActions transaction completed successfully",
		"creator", msg.Creator,
		"processed_count", result.ProcessedCount,
		"approved_count", result.ApprovedCount,
		"ignored_count", result.IgnoredCount,
		"new_settled_height", msg.NextBlockHeight)

	return &types.MsgResolveActionsResponse{
		ProcessedActionsCount: result.ProcessedCount,
		ApprovedActionsCount:  result.ApprovedCount,
		IgnoredActionsCount:   result.IgnoredCount,
	}, nil
}
