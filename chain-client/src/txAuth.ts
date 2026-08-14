// The extension option that routes a transaction's signature verification.
// The chain reads a tx with no extension as Cosmos-authenticated; carrying
// TX_AUTH_MODE_MINA switches the ante chain to verifying a Schnorr signature
// from the sender's registered Mina key instead (pulsar-chain,
// app/ante/tx_mode.go). The codec comes from the services-free generation for
// the same reason as keyregistryTx.ts: src/generated would drag @grpc/grpc-js
// into the browser bundle.
import {
    TxAuthMode,
    TxAuthModeExtension,
} from "./generated-web/pulsarchain/ante/v1/tx_auth.js";

export { TxAuthMode, TxAuthModeExtension, TX_AUTH_MODE_EXTENSION_TYPE_URL };

// Proto type URL the ante handler matches extension options against.
const TX_AUTH_MODE_EXTENSION_TYPE_URL = "/pulsarchain.ante.v1.TxAuthModeExtension";
