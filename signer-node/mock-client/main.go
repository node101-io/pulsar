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

	request := VerifyActionListRequest{
		Actions: []PulsarAction{
			{
				PublicKey:   "B62qpKT9DUstTLhqJpXUreqiFePo8toBmFddv5xSRoAoxAVcUG3DpoY",
				Amount:      "10000000123",
				ActionType:  "withdraw",
				BlockHeight: 12345,
			},
			{
				PublicKey:   "B62qpKT9DUstTLhqJpXUreqiFePo8toBmFddv5xSRoAoxAVcUG3DpoY",
				Amount:      "1000000123",
				ActionType:  "deposit",
				BlockHeight: 12346,
			},
		},
		Balances: map[string]string{
			"B62qp1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ": "750000",
			"B62qr9876543210zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCB":  "250000",
		},
		Witness:       "someMerkleWitnessStringOrHash",
		SettledHeight: 12000,
		NextHeight:    13000,
	}

	response, err := client.Sign(request)
	if err != nil {
		log.Printf("Sign request failed: %v", err)
		return
	}

	fmt.Printf("✓ Sign request successful!\n")
	fmt.Printf("  - Mask: %v\n", response.Mask)

	fmt.Println("\n3. Testing with empty actions...")

	emptyRequest := VerifyActionListRequest{
		Actions:       []PulsarAction{},
		Balances:      map[string]string{},
		Witness:       "",
		SettledHeight: 0,
		NextHeight:    0,
	}

	emptyResponse, err := client.Sign(emptyRequest)
	if err != nil {
		log.Printf("Empty sign request failed: %v", err)
		return
	}

	fmt.Printf("✓ Empty sign request successful!\n")
	fmt.Printf("  - Mask: %v\n", emptyResponse.Mask)

	fmt.Println("\nMock client testing completed!")
}
