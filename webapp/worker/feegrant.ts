// Pays the fee for a user's one registration transaction.
//
// A brand-new Pulsar address has no account in the auth store, so it cannot
// sign anything: the ante handler rejects an unknown signer. Granting an
// allowance fixes both halves at once — x/feegrant creates the grantee account
// as a side effect of the grant, and then covers the fee. Nothing is
// transferred, and the allowance only applies to the registration message.

import { DirectSecp256k1Wallet, encodePubkey, makeAuthInfoBytes, coin } from "@cosmjs/proto-signing";
import { Any } from "cosmjs-types/google/protobuf/any";
import { AllowedMsgAllowance, BasicAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/feegrant";
import { MsgGrantAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/tx";
import { SignDoc, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { fromBase64, fromHex, toBase64 } from "@cosmjs/encoding";
import { MSG_REGISTER_USER_KEYS_TYPE_URL } from "pulsar-chain-client/messages";

const BECH32_PREFIX = "pulsar";
const DENOM = "pmina";

// Registration costs 200k gas at the chain's 0.0001 minimum, so a couple of
// hundred pmina. This leaves room for a few retries and nothing more.
const SPEND_LIMIT = "10000";
const GRANT_GAS = 200_000;
const GRANT_FEE = "2000";

export type GrantResult =
  | { status: "granted"; granter: string; txHash: string }
  | { status: "already-granted"; granter: string }
  | { status: "error"; message: string };

/** The address the grants come from, without touching the chain. */
export async function granterAddress(keyHex: string): Promise<string> {
  const wallet = await DirectSecp256k1Wallet.fromKey(granterKey(keyHex), BECH32_PREFIX);
  const [granter] = await wallet.getAccounts();
  return granter.address;
}

export async function grantRegistrationFee(
  grantee: string,
  keyHex: string,
  rpcUrl: string,
  restUrl: string,
): Promise<GrantResult> {
  if (!grantee.startsWith(`${BECH32_PREFIX}1`)) {
    return { status: "error", message: "not a Pulsar address" };
  }

  let wallet: DirectSecp256k1Wallet;
  try {
    wallet = await DirectSecp256k1Wallet.fromKey(granterKey(keyHex), BECH32_PREFIX);
  } catch (error) {
    // Bad hex or the wrong key length. An operator problem, so say so rather
    // than letting it surface later as an unfunded granter.
    return { status: "error", message: `granter key is misconfigured: ${(error as Error).message}` };
  }
  const [granter] = await wallet.getAccounts();

  if (await hasAllowance(restUrl, granter.address, grantee)) {
    return { status: "already-granted", granter: granter.address };
  }

  let auth: { accountNumber: bigint; sequence: number };
  try {
    auth = await fetchAuth(restUrl, granter.address);
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
          value: MsgGrantAllowance.encode(
            MsgGrantAllowance.fromPartial({
              granter: granter.address,
              grantee,
              allowance: Any.fromPartial({
                typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
                value: AllowedMsgAllowance.encode(
                  AllowedMsgAllowance.fromPartial({
                    allowance: Any.fromPartial({
                      typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
                      value: BasicAllowance.encode(
                        BasicAllowance.fromPartial({
                          spendLimit: [coin(SPEND_LIMIT, DENOM)],
                        }),
                      ).finish(),
                    }),
                    // The grant buys exactly one thing. Anything else the
                    // grantee sends, they pay for.
                    allowedMessages: [MSG_REGISTER_USER_KEYS_TYPE_URL],
                  }),
                ).finish(),
              }),
            }),
          ).finish(),
        },
      ],
    }),
  ).finish();

  const signDoc = SignDoc.fromPartial({
    bodyBytes,
    authInfoBytes: makeAuthInfoBytes(
      [
        {
          pubkey: encodePubkey({
            type: "tendermint/PubKeySecp256k1",
            value: toBase64(granter.pubkey),
          }),
          sequence: auth.sequence,
        },
      ],
      [coin(GRANT_FEE, DENOM)],
      GRANT_GAS,
      undefined,
      undefined,
    ),
    chainId: await fetchChainId(rpcUrl),
    accountNumber: auth.accountNumber,
  });

  const signed = await wallet.signDirect(granter.address, signDoc);
  const txBytes = TxRaw.encode({
    bodyBytes: signed.signed.bodyBytes,
    authInfoBytes: signed.signed.authInfoBytes,
    signatures: [fromBase64(signed.signature.signature)],
  }).finish();

  return broadcast(rpcUrl, restUrl, txBytes, granter.address, grantee);
}

export async function hasAllowance(restUrl: string, granter: string, grantee: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${restUrl}/cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchAuth(
  restUrl: string,
  address: string,
): Promise<{ accountNumber: bigint; sequence: number }> {
  const res = await fetch(`${restUrl}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!res.ok) throw new Error(`granter account unavailable (${res.status})`);

  const body = (await res.json()) as {
    account?: { account_number?: string; sequence?: string };
  };
  if (!body.account?.account_number) throw new Error("granter account has no number");

  return {
    accountNumber: BigInt(body.account.account_number),
    sequence: Number(body.account.sequence ?? "0"),
  };
}

async function fetchChainId(rpcUrl: string): Promise<string> {
  const res = await fetch(`${rpcUrl}/status`);
  const body = (await res.json()) as {
    result?: { node_info?: { network?: string } };
  };
  const chainId = body.result?.node_info?.network;
  if (!chainId) throw new Error("could not read chain id");
  return chainId;
}

async function broadcast(
  rpcUrl: string,
  restUrl: string,
  txBytes: Uint8Array,
  granter: string,
  grantee: string,
): Promise<GrantResult> {
  // broadcast_tx_commit, not _sync: the grant is what brings the account into
  // existence, so a caller can do nothing until it is in a block. Waiting here
  // keeps that a detail of this endpoint instead of something every caller has
  // to know.
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "broadcast_tx_commit",
      params: { tx: toBase64(txBytes) },
    }),
  });

  const body = (await res.json()) as {
    result?: {
      hash?: string;
      check_tx?: { code?: number; log?: string };
      tx_result?: { code?: number; log?: string };
    };
    error?: { message?: string; data?: string };
  };

  if (body.error) {
    // The node gives up at timeout_broadcast_tx_commit even when the
    // transaction lands. Asking the chain settles which happened.
    if (await hasAllowance(restUrl, granter, grantee)) {
      return { status: "already-granted", granter };
    }
    return { status: "error", message: body.error.data ?? body.error.message ?? "rpc error" };
  }

  const result = body.result;
  if (!result) return { status: "error", message: "no result from rpc" };

  // A grant can pass CheckTx and still fail when it executes.
  for (const stage of [result.check_tx, result.tx_result]) {
    if (!stage?.code) continue;
    // Two clients racing the same address is a normal outcome, not a failure.
    if (stage.log?.includes("fee allowance already exists")) {
      return { status: "already-granted", granter };
    }
    return { status: "error", message: stage.log ?? `grant failed with code ${stage.code}` };
  }

  return { status: "granted", granter, txHash: result.hash ?? "" };
}

function granterKey(keyHex: string): Uint8Array {
  return fromHex(keyHex.startsWith("0x") ? keyHex.slice(2) : keyHex);
}
