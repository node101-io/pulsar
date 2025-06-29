package types

import (
	"testing"

	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/node101-io/pulsar/cosmos/testutil/sample"
	"github.com/stretchr/testify/require"
)

func TestMsgCreateKeyStore_ValidateBasic(t *testing.T) {
	tests := []struct {
		name string
		msg  MsgCreateKeyStore
		err  error
	}{
		{
			name: "invalid address",
			msg: MsgCreateKeyStore{
				Creator: "invalid_address",
			},
			err: sdkerrors.ErrInvalidAddress,
		}, {
			name: "valid address",
			msg: MsgCreateKeyStore{
				Creator: sample.AccAddress(),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.msg.ValidateBasic()
			if tt.err != nil {
				require.ErrorIs(t, err, tt.err)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestMsgUpdateKeyStore_ValidateBasic(t *testing.T) {
	tests := []struct {
		name string
		msg  MsgUpdateKeyStore
		err  error
	}{
		{
			name: "invalid address",
			msg: MsgUpdateKeyStore{
				Creator: "invalid_address",
			},
			err: sdkerrors.ErrInvalidAddress,
		}, {
			name: "valid address",
			msg: MsgUpdateKeyStore{
				Creator: sample.AccAddress(),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.msg.ValidateBasic()
			if tt.err != nil {
				require.ErrorIs(t, err, tt.err)
				return
			}
			require.NoError(t, err)
		})
	}
}
