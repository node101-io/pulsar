package keeper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

const signerVerifyURL = "http://localhost:9101/verify-actions"

type VerifyActionListRequest struct {
	Actions       []types.PulsarAction `json:"actions"`
	Balances      map[string]string    `json:"balances"`
	Witness       string               `json:"witness"`
	SettledHeight uint64               `json:"settled_height"`
	NextHeight    uint64               `json:"next_height"`
}

// VerifyActionList verifies the integrity of an action list with the signer node
func (k Keeper) VerifyActionList(ctx sdk.Context, settledHeight uint64, actions []types.PulsarAction, nextHeight uint64, witness string) ([]bool, error) {
	// Basic validations first
	if nextHeight <= settledHeight {
		return nil, types.ErrInvalidBlockHeight
	}

	if len(actions) == 0 {
		return nil, types.ErrEmptyActionList
	}

	var balancesMap = make(map[string]string)

	// Validate each action
	for i, action := range actions {
		if err := k.validateAction(action); err != nil {
			ctx.Logger().Error("Invalid action in list",
				"index", i,
				"action", action,
				"error", err)
			continue
		}

		balance := k.GetWithdrawalBalance(ctx, action.PublicKey)

		balancesMap[action.PublicKey] = balance.String()

	}

	// Log the verification attempt
	ctx.Logger().Info("Verifying action list with signer node",
		"settled_height", settledHeight,
		"next_height", nextHeight,
		"actions_count", len(actions),
		"merkle_witness", witness)

	payload := VerifyActionListRequest{
		Actions:       actions,
		Balances:      balancesMap,
		Witness:       witness,
		SettledHeight: settledHeight,
		NextHeight:    nextHeight,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal verify request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, signerVerifyURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post to signer: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read signer response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("signer non-200 status %d: %s", resp.StatusCode, string(respBytes))
	}

	var results []bool
	if err := json.Unmarshal(respBytes, &results); err != nil {
		return nil, fmt.Errorf("unmarshal signer response: %w", err)
	}

	ctx.Logger().Info("Signer verification completed",
		"results_len", len(results))

	return results, nil
}

// validateAction performs basic validation on a single action
func (k Keeper) validateAction(action types.PulsarAction) error {
	// Validate public key
	if err := k.ValidateMinaPublicKey(action.PublicKey); err != nil {
		return err
	}

	// Validate amount
	if action.Amount.IsZero() || action.Amount.IsNegative() {
		return types.ErrInvalidAmount
	}

	// Validate action type
	if action.ActionType != "deposit" && action.ActionType != "withdrawal" && action.ActionType != "settlement" {
		return types.ErrInvalidActionType
	}

	// Validate block height
	if action.BlockHeight == 0 {
		return types.ErrInvalidBlockHeight
	}

	return nil
}
