package types

import (
	"cosmossdk.io/math"
	paramtypes "github.com/cosmos/cosmos-sdk/x/params/types"
)

var _ paramtypes.ParamSet = (*Params)(nil)

// ParamKeyTable the param key table for launch module
func ParamKeyTable() paramtypes.KeyTable {
	return paramtypes.NewKeyTable().RegisterParamSet(&Params{})
}

// NewParams creates a new Params instance
func NewParams(commissionRate math.LegacyDec, pminaDenom string, proverReward math.Int) Params {
	return Params{
		CommissionRate: commissionRate,
		PminaDenom:     pminaDenom,
		ProverReward:   proverReward,
	}
}

// DefaultParams returns a default set of parameters
func DefaultParams() Params {
	return Params{
		CommissionRate: math.LegacyNewDecWithPrec(2, 2), // 0.02 = 2%
		PminaDenom:     "upmina",                        // Default pMINA denomination
		ProverReward:   math.NewInt(1000000),            // 1 MINA (1,000,000 micro MINA)
	}
}

// ParamSetPairs get the params.ParamSet
func (p *Params) ParamSetPairs() paramtypes.ParamSetPairs {
	return paramtypes.ParamSetPairs{}
}

// Validate validates the set of params
func (p Params) Validate() error {
	if p.CommissionRate.IsNegative() || p.CommissionRate.GT(math.LegacyOneDec()) {
		return ErrInvalidCommissionRate
	}

	if p.PminaDenom == "" {
		return ErrInvalidPMinaDenom
	}

	if p.ProverReward.IsNegative() {
		return ErrInvalidAmount
	}

	return nil
}
