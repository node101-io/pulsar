package types

import (
	cdctypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/msgservice"
	"github.com/cosmos/cosmos-sdk/types/tx"
	//"github.com/node101-io/pulsar/cosmos/x/minakeys/signing"
	// this line is used by starport scaffolding # 1
)

func RegisterInterfaces(registry cdctypes.InterfaceRegistry) {
	registry.RegisterImplementations((*sdk.Msg)(nil),
		&MsgCreateKeyStore{},
		&MsgUpdateKeyStore{},
	)
	// this line is used by starport scaffolding # 3

	registry.RegisterImplementations((*sdk.Msg)(nil),
		&MsgUpdateParams{},
	)

	// Register TxTypeExtension for extension options
	registry.RegisterImplementations((*tx.TxExtensionOptionI)(nil),
		&TxTypeExtension{},
	)

	msgservice.RegisterMsgServiceDesc(registry, &_Msg_serviceDesc)

	// Register crypto types
	//signing.RegisterInterfaces(registry)
}
