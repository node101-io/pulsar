package keeper

import (
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

var _ types.QueryServer = Keeper{}
