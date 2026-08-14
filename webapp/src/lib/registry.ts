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
  QueryGetUserCosmosPublicKeyRequest,
  QueryGetUserCosmosPublicKeyResponse,
} from "pulsar-chain-client/messages";

import { consumerChain } from "./constants";
import { formatMinaPublicKey } from "./crypto";
import { AbciQueryError, SDK_ERR_KEY_NOT_FOUND, abciQuery } from "./utils";

export { pulsarAddressFromCosmosPubkey, resolveMinaAddress };

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
