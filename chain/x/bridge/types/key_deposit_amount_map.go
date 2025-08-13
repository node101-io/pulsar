package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// DepositAmountMapKeyPrefix is the prefix to retrieve all DepositAmountMap
	DepositAmountMapKeyPrefix = "DepositAmountMap/value/"
)

// DepositAmountMapKey returns the store key to retrieve a DepositAmountMap from the address
func DepositAmountMapKey(
	address string,
) []byte {
	var key []byte

	addressBytes := []byte(address)
	key = append(key, addressBytes...)
	key = append(key, []byte("/")...)

	return key
}
