package types

// DefaultIndex is the default global index
const DefaultIndex uint64 = 1

// DefaultGenesis returns the default genesis state
func DefaultGenesis() *GenesisState {
	return &GenesisState{
		Params: DefaultParams(),
		BridgeState: BridgeState{
			WithdrawalBalances: []WithdrawalBalance{},
			RewardBalances:     []RewardBalance{},
			ApprovedActions:    []PulsarAction{},
			ApprovedActionHash: "",
			AllActionHash:      "",
			SettledBlockHeight: 0,
		},
	}
}

// Validate performs basic genesis state validation returning an error upon any
// failure.
func (gs GenesisState) Validate() error {
	if err := gs.Params.Validate(); err != nil {
		return err
	}

	// Validate withdrawal balances
	for _, wb := range gs.BridgeState.WithdrawalBalances {
		if wb.PublicKey == "" {
			return ErrInvalidPublicKey
		}
		if wb.Amount.IsNil() || wb.Amount.IsNegative() {
			return ErrInvalidAmount
		}
	}

	// Validate reward balances
	for _, rb := range gs.BridgeState.RewardBalances {
		if rb.PublicKey == "" {
			return ErrInvalidPublicKey
		}
		if rb.Amount.IsNil() || rb.Amount.IsNegative() {
			return ErrInvalidAmount
		}
	}

	// Validate approved actions
	for _, action := range gs.BridgeState.ApprovedActions {
		if action.PublicKey == "" {
			return ErrInvalidPublicKey
		}
		if action.Amount.IsNil() || action.Amount.IsNegative() {
			return ErrInvalidAmount
		}
		if action.ActionType == "" {
			return ErrInvalidActionType
		}
	}

	return nil
}
