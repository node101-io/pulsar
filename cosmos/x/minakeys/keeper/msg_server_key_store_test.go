package keeper_test

import (
	"strconv"
	"testing"

	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/stretchr/testify/require"

	keepertest "github.com/node101-io/pulsar/cosmos/testutil/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func TestKeyStoreMsgServerCreate(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)
	creator := "A"
	for i := 0; i < 5; i++ {
		expected := &types.MsgCreateKeyStore{Creator: creator,
			Index: strconv.Itoa(i),
		}
		_, err := srv.CreateKeyStore(ctx, expected)
		require.NoError(t, err)
		rst, found := k.GetKeyStore(ctx,
			expected.Index,
		)
		require.True(t, found)
		require.Equal(t, expected.Creator, rst.Creator)
	}
}

func TestKeyStoreMsgServerUpdate(t *testing.T) {
	creator := "A"

	tests := []struct {
		desc    string
		request *types.MsgUpdateKeyStore
		err     error
	}{
		{
			desc: "Completed",
			request: &types.MsgUpdateKeyStore{Creator: creator,
				Index: strconv.Itoa(0),
			},
		},
		{
			desc: "Unauthorized",
			request: &types.MsgUpdateKeyStore{Creator: "B",
				Index: strconv.Itoa(0),
			},
			err: sdkerrors.ErrUnauthorized,
		},
		{
			desc: "KeyNotFound",
			request: &types.MsgUpdateKeyStore{Creator: creator,
				Index: strconv.Itoa(100000),
			},
			err: sdkerrors.ErrKeyNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			k, ctx := keepertest.MinakeysKeeper(t)
			srv := keeper.NewMsgServerImpl(k)
			expected := &types.MsgCreateKeyStore{Creator: creator,
				Index: strconv.Itoa(0),
			}
			_, err := srv.CreateKeyStore(ctx, expected)
			require.NoError(t, err)

			_, err = srv.UpdateKeyStore(ctx, tc.request)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
			} else {
				require.NoError(t, err)
				rst, found := k.GetKeyStore(ctx,
					expected.Index,
				)
				require.True(t, found)
				require.Equal(t, expected.Creator, rst.Creator)
			}
		})
	}
}

func TestKeyStoreMsgServerDelete(t *testing.T) {
	creator := "A"

	tests := []struct {
		desc    string
		request *types.MsgDeleteKeyStore
		err     error
	}{
		{
			desc: "Completed",
			request: &types.MsgDeleteKeyStore{Creator: creator,
				Index: strconv.Itoa(0),
			},
		},
		{
			desc: "Unauthorized",
			request: &types.MsgDeleteKeyStore{Creator: "B",
				Index: strconv.Itoa(0),
			},
			err: sdkerrors.ErrUnauthorized,
		},
		{
			desc: "KeyNotFound",
			request: &types.MsgDeleteKeyStore{Creator: creator,
				Index: strconv.Itoa(100000),
			},
			err: sdkerrors.ErrKeyNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			k, ctx := keepertest.MinakeysKeeper(t)
			srv := keeper.NewMsgServerImpl(k)

			_, err := srv.CreateKeyStore(ctx, &types.MsgCreateKeyStore{Creator: creator,
				Index: strconv.Itoa(0),
			})
			require.NoError(t, err)
			_, err = srv.DeleteKeyStore(ctx, tc.request)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
			} else {
				require.NoError(t, err)
				_, found := k.GetKeyStore(ctx,
					tc.request.Index,
				)
				require.False(t, found)
			}
		})
	}
}
