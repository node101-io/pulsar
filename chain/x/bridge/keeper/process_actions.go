package keeper

import (
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

// ProcessResult holds the results of processing actions
type ProcessResult struct {
	ProcessedCount uint64
	ApprovedCount  uint64
	IgnoredCount   uint64
}

// ProcessActions processes a list of actions and updates the bridge state
func (k Keeper) ProcessActions(ctx sdk.Context, actions []types.PulsarAction, nextHeight uint64) (*ProcessResult, error) {
	result := &ProcessResult{}

	// Get current approved actions and hashes
	approvedActions := k.GetApprovedActions(ctx)
	approvedHash := k.GetApprovedActionHash(ctx)
	allActionHash := k.GetAllActionHash(ctx)

	// Initialize hashes if empty (genesis case)
	if approvedHash == "" {
		approvedHash = k.InitializeHash()
	}
	if allActionHash == "" {
		allActionHash = k.InitializeHash()
	}

	ctx.Logger().Info("Starting action processing",
		"actions_count", len(actions),
		"next_height", nextHeight,
		"current_approved_actions", len(approvedActions))

	// Process each action
	for i, action := range actions {
		result.ProcessedCount++

		// Always update all action hash (regardless of whether action is approved or ignored)
		allActionHash = k.UpdateHash(allActionHash, action)

		ctx.Logger().Debug("Processing action",
			"index", i,
			"action_type", action.ActionType,
			"mina_public_key", action.PublicKey,
			"amount", action.Amount.String(),
			"block_height", action.BlockHeight)

		// Process based on action type
		var wasApproved bool
		switch action.ActionType {
		case "deposit":
			wasApproved = k.processDepositAction(ctx, action, &approvedActions, &approvedHash)

		case "withdrawal":
			wasApproved = k.processWithdrawalAction(ctx, action, &approvedActions, &approvedHash)

		case "settlement":
			k.processSettlementAction(ctx, action, &approvedActions, &approvedHash)
			wasApproved = true

		default:
			ctx.Logger().Warn("Unknown action type, ignoring",
				"action_type", action.ActionType,
				"mina_public_key", action.PublicKey)
			result.IgnoredCount++
			continue
		}

		// Update counters
		if wasApproved {
			result.ApprovedCount++
		} else {
			result.IgnoredCount++
		}
	}

	// Update state with new values
	k.SetApprovedActions(ctx, approvedActions)
	k.SetApprovedActionHash(ctx, approvedHash)
	k.SetAllActionHash(ctx, allActionHash)

	ctx.Logger().Info("Action processing completed",
		"processed_count", result.ProcessedCount,
		"approved_count", result.ApprovedCount,
		"ignored_count", result.IgnoredCount,
		"new_approved_actions_total", len(approvedActions),
		"new_approved_hash", approvedHash,
		"new_all_action_hash", allActionHash)

	return result, nil
}
