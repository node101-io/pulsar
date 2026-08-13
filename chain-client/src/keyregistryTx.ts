// Message codecs from the services-free generation (src/generated-web): these
// build a transaction body for a wallet to sign, they never call the Msg
// service. Taking them from src/generated would pull @grpc/grpc-js in with
// them and make this module unbundlable for the browser.
//
// Only the user path is here. The chain also exposes RegisterValidatorKeys /
// UpdateValidatorKeys, but a validator registers through the node's CLI with
// its consensus key — it never reaches the chain through a browser bundle.
import { MsgRegisterUserKeys } from "./generated-web/pulsarchain/keyregistry/v1/tx.js";

export { MsgRegisterUserKeys, MSG_REGISTER_USER_KEYS_TYPE_URL };

// Proto type URL for registering the message in a cosmjs Registry. The
// generated codec IS the encoder — nothing hand-rolled at the boundary.
const MSG_REGISTER_USER_KEYS_TYPE_URL =
  "/pulsarchain.keyregistry.v1.MsgRegisterUserKeys";
