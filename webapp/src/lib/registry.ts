// The one place a Mina address is turned into the Pulsar account it is
// registered to. The chain itself never does this for a payment — MsgSend
// takes only bech32 addresses, there is no send restriction or address
// rewriting in the ante chain — so anywhere the app accepts a B62q… where
// money will move, it must resolve through here first and refuse when the
// registry has no answer. Sending to a derived-but-unregistered address would
// otherwise strand funds in an account nobody can spend from.

import { rawSecp256k1PubkeyToRawAddress } from "@cosmjs/amino";
import { toBech32 } from "@cosmjs/encoding";
import {
  KEYREGISTRY_QUERY_USER_COSMOS_KEY,
  KEYREGISTRY_QUERY_USER_MINA_KEY,
  QueryGetUserCosmosPublicKeyRequest,
  QueryGetUserCosmosPublicKeyResponse,
  QueryGetUserMinaPublicKeyRequest,
  QueryGetUserMinaPublicKeyResponse,
} from "pulsar-chain-client/messages";

import { consumerChain } from "./constants";
import { formatMinaPublicKey, parseMinaPublicKey } from "./crypto";
import { AbciQueryError, SDK_ERR_KEY_NOT_FOUND, abciQuery } from "./utils";

export { pulsarAddressFromCosmosPubkey, resolveCosmosPublicKey, resolveMinaAddress };

/**
 * A Cosmos pubkey as the Pulsar address deposits credit and sends pay into,
 * derived exactly the way the chain derives it: ripemd160(sha256(compressed
 * key)) in bech32. See x/bridge applyDeposit -> userAddressFromCosmosPubKey.
 */
function pulsarAddressFromCosmosPubkey(cosmosPublicKey: Uint8Array): string {
  return toBech32(
    consumerChain.bech32Prefix!,
    rawSecp256k1PubkeyToRawAddress(cosmosPublicKey),
  );
}

/**
 * The registry's answer for one Mina address, or null when it has none.
 *
 * Null only ever means "not registered": every other failure (a bad address,
 * an unreachable node) stays an exception, because treating it as "not
 * registered" would tell a sender their recipient cannot receive when the
 * truth is unknown.
 */
async function resolveMinaAddress(
  minaAddress: string,
): Promise<{ cosmosPublicKey: Uint8Array; pulsarAddress: string } | null> {
  const packed = await formatMinaPublicKey(minaAddress);
  const request = QueryGetUserCosmosPublicKeyRequest.encode(
    QueryGetUserCosmosPublicKeyRequest.fromPartial({
      user_mina_public_key: Buffer.from(packed),
    }),
  ).finish();

  let value: Uint8Array;
  try {
    value = await abciQuery(KEYREGISTRY_QUERY_USER_COSMOS_KEY, request);
  } catch (error) {
    // The keeper reports a miss as an error; for us "not registered" is an
    // answer. Every other code is a real failure and stays one.
    if (error instanceof AbciQueryError && error.code === SDK_ERR_KEY_NOT_FOUND) {
      return null;
    }
    throw error;
  }

  const { user_cosmos_public_key: cosmosKey } =
    QueryGetUserCosmosPublicKeyResponse.decode(value);
  if (!cosmosKey?.length) return null;

  return {
    cosmosPublicKey: cosmosKey,
    pulsarAddress: pulsarAddressFromCosmosPubkey(cosmosKey),
  };
}

/**
 * The registry's answer for one Cosmos public key, or null when it has none.
 *
 * The reverse of resolveMinaAddress, and what makes a Keplr-only session
 * whole: registration can only be QUERIED from this side without a Mina
 * wallet — performing one still takes Auro, since it is the Mina signature
 * that a registration exists to prove.
 */
async function resolveCosmosPublicKey(
  cosmosPublicKey: Uint8Array,
): Promise<{ minaPublicKey: Uint8Array; minaAddress: string } | null> {
  const request = QueryGetUserMinaPublicKeyRequest.encode(
    QueryGetUserMinaPublicKeyRequest.fromPartial({
      user_cosmos_public_key: Buffer.from(cosmosPublicKey),
    }),
  ).finish();

  let value: Uint8Array;
  try {
    value = await abciQuery(KEYREGISTRY_QUERY_USER_MINA_KEY, request);
  } catch (error) {
    if (error instanceof AbciQueryError && error.code === SDK_ERR_KEY_NOT_FOUND) {
      return null;
    }
    throw error;
  }

  const { user_mina_public_key: minaKey } =
    QueryGetUserMinaPublicKeyResponse.decode(value);
  if (!minaKey?.length) return null;

  return {
    minaPublicKey: minaKey,
    minaAddress: await parseMinaPublicKey(minaKey),
  };
}
