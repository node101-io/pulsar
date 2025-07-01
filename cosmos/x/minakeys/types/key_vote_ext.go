package types

import "encoding/binary"

var _ binary.ByteOrder

const (
	// VoteExtKeyPrefix is the prefix to retrieve all VoteExt
	VoteExtKeyPrefix = "VoteExt/value/"
)

// VoteExtKey returns the store key to retrieve a VoteExt from the index fields
func VoteExtKey(
	index string,
) []byte {
	var key []byte

	indexBytes := []byte(index)
	key = append(key, indexBytes...)
	key = append(key, []byte("/")...)

	return key
}
