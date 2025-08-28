package keeper

import (
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/types"
)

var _ types.QueryServer = Keeper{}
