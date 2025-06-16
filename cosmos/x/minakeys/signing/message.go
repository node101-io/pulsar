package signing

import (
	"encoding/hex"

	proto "github.com/cosmos/gogoproto/proto"
)

// Ensure that minaPubKey and minaPrivKey implement proto.Message so that
// gogoproto/jsonpb can treat them as custom message types during JSON
// serialization.

// Reset clears the key.
func (pk *minaPubKey) Reset() { *pk = minaPubKey{} }

// String returns a compact string representation.
func (pk *minaPubKey) String() string {
	if pk == nil || pk.pk == nil {
		return ""
	}
	bz, _ := pk.pk.MarshalBytes()
	return hex.EncodeToString(bz)
}

// ProtoMessage is a dummy method to satisfy proto.Message.
func (*minaPubKey) ProtoMessage() {}

// Same for private key (without revealing secret bytes).
func (sk *minaPrivKey) Reset()         { *sk = minaPrivKey{} }
func (sk *minaPrivKey) String() string { return "[MINA-PRIVATE-KEY]" }
func (*minaPrivKey) ProtoMessage()     {}

func init() {
	// Register types so that proto.MessageType("minaPubKey") works.
	proto.RegisterType((*minaPubKey)(nil), "minaPubKey")
	proto.RegisterType((*minaPrivKey)(nil), "minaPrivKey")
}
