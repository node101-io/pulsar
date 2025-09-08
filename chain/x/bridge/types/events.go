package types

// Event types for the bridge module
const (
	EventTypeLockForWithdrawal   = "lock_for_withdrawal"
	EventTypeResolveActions      = "resolve_actions"
	EventTypeDepositProcessed    = "deposit_processed"
	EventTypeWithdrawalProcessed = "withdrawal_processed"
	EventTypeSettlementProcessed = "settlement_processed"
)

// Event attributes
const (
	AttributeKeyCreator         = "creator"
	AttributeKeyPublicKey       = "public_key"
	AttributeKeyAmount          = "amount"
	AttributeKeyActionType      = "action_type"
	AttributeKeyProver          = "prover"
	AttributeKeyProcessedCount  = "processed_count"
	AttributeKeyApprovedCount   = "approved_count"
	AttributeKeyIgnoredCount    = "ignored_count"
	AttributeKeyBlockHeight     = "block_height"
	AttributeKeyCosmosAddress   = "cosmos_address"
	AttributeKeyCosmosSignature = "cosmos_signature"
	AttributeKeyNewHash         = "new_hash"
	AttributeKeyBalance         = "balance"
)
