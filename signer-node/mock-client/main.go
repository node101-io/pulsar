package main

import (
	"fmt"
	"log"
)

func main() {
	client := NewSignerClient("http://localhost:6000")

	fmt.Println("Signer Node Mock Client")
	fmt.Println("======================")

	fmt.Println("\n1. Testing health check...")
	err := client.Health()
	if err != nil {
		log.Printf("Health check failed: %v", err)
	} else {
		fmt.Println("✓ Health check passed")
	}

	fmt.Println("\n2. Testing sign request...")

	actions := []Action{
		{
			Actions: [][]string{{"1", "26973006405062159512790757462220334501049036066062639169100994120562073048293", "1", "10000000123", "0", "0", "0", "0"}},
			Hash:    "3151300440494715372841251656330716971989598282112888106614242778489038271481",
		},
		{
			Actions: [][]string{{"2", "26973006405062159512790757462220334501049036066062639169100994120562073048293", "1", "1000000123", "0", "0", "0", "0"}},
			Hash:    "24310058228986042206896921523192218206644302797295485420978811975548466572153",
		},
	}

	withdrawMapping := map[string]any{
		"user1": 10000000123,
		"user2": 1000000123,
	}

	response, err := client.Sign(actions, withdrawMapping)
	if err != nil {
		log.Printf("Sign request failed: %v", err)
		return
	}

	fmt.Printf("✓ Sign request successful!\n")
	fmt.Printf("  - IsValid: %t\n", response.IsValid)
	fmt.Printf("  - Mask: %v\n", response.Mask)

	fmt.Println("\n3. Testing with empty actions...")

	emptyActions := []Action{}
	emptyMapping := map[string]any{}

	emptyResponse, err := client.Sign(emptyActions, emptyMapping)
	if err != nil {
		log.Printf("Empty sign request failed: %v", err)
		return
	}

	fmt.Printf("✓ Empty sign request successful!\n")
	fmt.Printf("  - IsValid: %t\n", emptyResponse.IsValid)
	fmt.Printf("  - Mask: %v\n", emptyResponse.Mask)

	fmt.Println("\nMock client testing completed!")
}
