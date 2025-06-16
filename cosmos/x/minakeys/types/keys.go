package types

const (
	// ModuleName defines the module name
	ModuleName = "minakeys"

	// StoreKey defines the primary module store key
	StoreKey = ModuleName

	// MemStoreKey defines the in-memory store key
	MemStoreKey = "mem_minakeys"
)

var (
	ParamsKey = []byte("p_minakeys")
)

func KeyPrefix(p string) []byte {
	return []byte(p)
}
