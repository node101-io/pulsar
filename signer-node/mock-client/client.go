package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type PulsarAction struct {
	PublicKey   string `json:"public_key,omitempty"`
	Amount      string `json:"amount"`
	ActionType  string `json:"action_type,omitempty"`
	BlockHeight uint64 `json:"block_height,omitempty"`
}

type VerifyActionListRequest struct {
	Actions       []PulsarAction    `json:"actions"`
	Balances      map[string]string `json:"balances"`
	Witness       string            `json:"witness"`
	SettledHeight uint64            `json:"settled_height"`
	NextHeight    uint64            `json:"next_height"`
}

type VerifyActionListResponse struct {
	Mask []bool `json:"mask"`
}

type SignerClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewSignerClient(baseURL string) *SignerClient {
	return &SignerClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *SignerClient) Sign(request VerifyActionListRequest) (*VerifyActionListResponse, error) {
	jsonData, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/sign", c.BaseURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var signResp VerifyActionListResponse
	if err := json.Unmarshal(body, &signResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return &signResp, nil
}

func (c *SignerClient) Health() error {
	url := fmt.Sprintf("%s/health", c.BaseURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create health check request: %w", err)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send health check request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed with status %d", resp.StatusCode)
	}

	return nil
}