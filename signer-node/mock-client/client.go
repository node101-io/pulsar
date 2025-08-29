package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Action struct {
	Actions [][]string `json:"actions"`
	Hash    string     `json:"hash"`
}

type SignRequest struct {
	Actions         []Action           `json:"actions"`
	WithdrawMapping map[string]any `json:"withdrawMapping"`
}

type SignResponse struct {
	IsValid bool `json:"isValid"`
	Mask    any  `json:"mask"`
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

func (c *SignerClient) Sign(actions []Action, withdrawMapping map[string]any) (*SignResponse, error) {
	signReq := SignRequest{
		Actions:         actions,
		WithdrawMapping: withdrawMapping,
	}

	jsonData, err := json.Marshal(signReq)
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

	var signResp SignResponse
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