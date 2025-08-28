package keeper

import (
	"context"

	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/bridge/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var _ types.QueryServer = Keeper{}

// TestQuery returns a test string "node101"
func (k Keeper) TestQuery(goCtx context.Context, req *types.QueryTestRequest) (*types.QueryTestResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid request")
	}

	return &types.QueryTestResponse{Result: "node101"}, nil
}
