package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// KeyStoreKeyPrefix is the prefix to retrieve all KeyStore
	KeyStoreKeyPrefix = "KeyStore/value/"
)

// KeyStoreKey returns the store key to retrieve a KeyStore from the index fields
func KeyStoreKey(
	index string,
) []byte {
	var key []byte

	indexBytes := []byte(index)
	key = append(key, indexBytes...)
	key = append(key, []byte("/")...)

	return key
}
