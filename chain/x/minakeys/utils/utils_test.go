package utils

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVerifyCosmosSignatureADR36_RealWalletSignature(t *testing.T) {
	// Real values from wallet.signArbitrary()
	cosmosPubKeyHex := "020313e5a5ed89afa2e5bf7dc85cf8da16e0258b4d6ca322e1d3c4a7ecde2f8f2f"
	message := "b9b5c1f0a591c3ff7212e09e52c996593dcca7246df908f97f1a48a4a1ff197d"
	signatureBase64 := "4k6cabw6nSyMaEckVjcCAFElUfu1p7KHbfRZdTi20tNx9uDXPYHkp5lTorei5D14MC0f0ugwJHaf3/dXIPo9FQ=="
	actualSignerAddress := "consumer1yzx78c92pfwshaegudzneck7k52g7mnhj45dx7"

	// Decode the base64 signature
	signatureBytes, err := base64.StdEncoding.DecodeString(signatureBase64)
	require.NoError(t, err)
	require.Equal(t, 64, len(signatureBytes), "ADR-36 signature should be 64 bytes")

	// Test the verification with the actual signer address
	err = VerifyCosmosSignatureADR36(
		cosmosPubKeyHex,
		actualSignerAddress,
		message,
		signatureBytes,
		"", // empty chainID for off-chain signing
	)

	require.NoError(t, err)

}
