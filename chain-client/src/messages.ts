// Browser-safe entry point: message codecs only.
//
// The root entry re-exports the gRPC transport, which drags in @grpc/grpc-js
// and through it node's `net`/`tls` — unbundlable for the web. A UI that only
// builds transactions and reads state over JSON-RPC imports from here instead.

export * from "./keyregistryTx.js";

// The field a Mina wallet signs, and the enums that name which transition it
// authorizes. o1js is loaded lazily inside the derivation, so importing this
// module still costs nothing until a challenge is actually built.
export * from "./keyregistryChallenge.js";

// Query codecs, for callers that reach the chain through Tendermint's
// /abci_query rather than a gRPC channel. The chain serves more keyregistry
// queries than these; a codec earns its place here when something imports it,
// because an unused one is a wire contract nothing proves.
export {
  QueryGetUserCosmosPublicKeyRequest,
  QueryGetUserCosmosPublicKeyResponse,
} from "./generated-web/pulsarchain/keyregistry/v1/query.js";

export {
  QueryLatestActionHashesRequest,
  QueryLatestActionHashesResponse,
} from "./generated-web/pulsarchain/bridge/v1/query.js";

// gRPC method paths, as /abci_query expects them.
export const KEYREGISTRY_QUERY_USER_COSMOS_KEY =
  "/pulsarchain.keyregistry.v1.Query/GetUserCosmosPublicKey";

// Answers how far into Mina the chain has scanned. The only reading of bridge
// progress that comes from the chain itself rather than from a wall clock.
export const BRIDGE_QUERY_LATEST_ACTION_HASHES =
  "/pulsarchain.bridge.v1.Query/LatestActionHashes";
