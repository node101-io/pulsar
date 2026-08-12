import { MsgPushNewActions } from "./generated/pulsarchain/bridge/v1/tx.js";

export { MsgPushNewActions, MSG_PUSH_NEW_ACTIONS_TYPE_URL, BRIDGE_CODESPACE };

// Proto type URL for registering the message in a cosmjs Registry. The
// generated codec IS the encoder — nothing hand-rolled at the boundary.
const MSG_PUSH_NEW_ACTIONS_TYPE_URL = "/pulsarchain.bridge.v1.MsgPushNewActions";

// The x/bridge module's error codespace (errors.Register(ModuleName, ...)).
// DeliverTx failures carry (codespace, code); consumers classify on those,
// never on the human-readable log string.
const BRIDGE_CODESPACE = "bridge";
