package keeper

import (
	"github.com/cosmos/interchain-security/v5/x/minakeys/types"
)

var _ types.QueryServer = Keeper{}
