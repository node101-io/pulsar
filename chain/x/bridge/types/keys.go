package types

const (
	// ModuleName defines the module name
	ModuleName = "bridge"

	// ModuleAccountName defines the module account name for minting/burning
	ModuleAccountName = ModuleName

	// StoreKey defines the primary module store key
	StoreKey = ModuleName

	// MemStoreKey defines the in-memory store key
	MemStoreKey = "mem_bridge"
)

var (
	ParamsKey = []byte("p_bridge")

	// State keys for bridge module
	WithdrawalBalancesKeyPrefix = []byte("withdrawal_balances")
	RewardBalancesKeyPrefix     = []byte("reward_balances")
	ApprovedActionsKey          = []byte("approved_actions")
	ApprovedActionHashKey       = []byte("approved_action_hash")
	AllActionHashKey            = []byte("all_action_hash")
	SettledBlockHeightKey       = []byte("settled_block_height")
)

func KeyPrefix(p string) []byte {
	return []byte(p)
}
