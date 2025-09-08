package keeper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

const signerBaseURL = "http://localhost:6000"
const signerSignPath = "/sign"

type VerifyActionListRequest struct {
	Actions       []types.PulsarAction `json:"actions"`
	Balances      map[string]string    `json:"balances"`
	Witness       string               `json:"witness"`
	SettledHeight uint64               `json:"settled_height"`
	NextHeight    uint64               `json:"next_height"`
}

type VerifyActionListResponse struct {
	Mask []bool `json:"mask"`
}

func (k Keeper) VerifyActionList(
	ctx sdk.Context,
	settledHeight uint64,
	actions []types.PulsarAction,
	nextHeight uint64,
	witness string,
) ([]bool, error) {

	if nextHeight <= settledHeight {
		return nil, types.ErrInvalidBlockHeight
	}
	if len(actions) == 0 {
		return nil, types.ErrEmptyActionList
	}

	balancesMap := make(map[string]string, len(actions))
	cleanActions := make([]types.PulsarAction, 0, len(actions))

	for _, action := range actions {
		cleanActions = append(cleanActions, action)

		bal := k.GetWithdrawalBalance(ctx, action.PublicKey)
		balancesMap[action.PublicKey] = bal.String()
	}

	ctx.Logger().Info("Verifying action list with signer node",
		"settled_height", settledHeight,
		"next_height", nextHeight,
		"actions_count", len(cleanActions),
	)

	payload := VerifyActionListRequest{
		Actions:       cleanActions,
		Balances:      balancesMap,
		Witness:       witness,
		SettledHeight: settledHeight,
		NextHeight:    nextHeight,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal verify request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, signerBaseURL+signerSignPath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 3 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post to signer: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read signer response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("signer status %d: %s", resp.StatusCode, string(respBytes))
	}

	var vr VerifyActionListResponse
	if err := json.Unmarshal(respBytes, &vr); err != nil {
		return nil, fmt.Errorf("unmarshal signer response: %w", err)
	}

	ctx.Logger().Info("Signer verification completed", "results_len", len(vr.Mask))
	return vr.Mask, nil
}
