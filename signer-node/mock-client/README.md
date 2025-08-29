# Signer Node Mock Client

A Go client library for interacting with the Pulsar signer-node service.

## Features

- **Sign Actions**: Send action queues to the signer node for validation and signing
- **Health Check**: Verify that the signer node is running and accessible
- **Error Handling**: Comprehensive error handling for network and API errors
- **JSON Serialization**: Proper marshaling/unmarshaling of request/response data

## Usage

### Basic Example

```go
package main

import (
    "fmt"
    "log"
)

func main() {
    // Create a new client pointing to your signer node
    client := NewSignerClient("http://localhost:6000")
    
    // Test health check
    err := client.Health()
    if err != nil {
        log.Fatal("Signer node is not available:", err)
    }
    
    // Prepare actions
    actions := []Action{
        {
            Actions: [][]string{{"deposit", "100", "user123"}},
            Hash:    "0x1234567890abcdef",
        },
    }
    
    // Prepare withdraw mapping
    withdrawMapping := map[string]any{
        "user123": 100,
    }
    
    // Send sign request
    response, err := client.Sign(actions, withdrawMapping)
    if err != nil {
        log.Fatal("Sign request failed:", err)
    }
    
    fmt.Printf("Valid: %t, Mask: %v\n", response.IsValid, response.Mask)
}
```

### Running the Example

```bash
# Start the signer node (in another terminal)
cd signer-node
npm start

# Run the mock client
cd signer-client
go run .
```

## API Reference

### Types

```go
type Action struct {
    Actions [][]string `json:"actions"`
    Hash    string     `json:"hash"`
}

type SignRequest struct {
    Actions         []Action       `json:"actions"`
    WithdrawMapping map[string]any `json:"withdrawMapping"`
}

type SignResponse struct {
    IsValid bool `json:"isValid"`
    Mask    any  `json:"mask"`
}
```

### Methods

#### `NewSignerClient(baseURL string) *SignerClient`
Creates a new signer client instance.

#### `Sign(actions []Action, withdrawMapping map[string]any) (*SignResponse, error)`
Sends a sign request to the signer node with the provided actions and withdraw mapping.

#### `Health() error`
Performs a health check on the signer node. Returns nil if healthy, error otherwise.

## Configuration

The client uses sensible defaults:
- HTTP timeout: 30 seconds
- Content-Type: application/json

You can customize the HTTP client by modifying the `HTTPClient` field after creating a client instance.

## Error Handling

The client provides detailed error messages for common failure scenarios:
- Network connectivity issues
- HTTP status errors
- JSON marshaling/unmarshaling errors
- Request timeout errors

## Dependencies

- Go 1.23+
- Standard library packages: `net/http`, `encoding/json`, `bytes`, `io`, `time`, `fmt`