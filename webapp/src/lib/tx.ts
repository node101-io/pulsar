import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxBody, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { makeAuthInfoBytes, encodePubkey, coin } from "@cosmjs/proto-signing";
import {
  MSG_REGISTER_USER_KEYS_TYPE_URL,
  MsgRegisterUserKeys,
} from "pulsar-chain-client/messages";

import { consumerChain } from "./constants";

// Every Pulsar transaction the UI builds. The chain reads a tx with no auth
// extension as Cosmos-authenticated, which is what a Keplr signature is — so
// nothing here needs an extension option.

export { createRegisterKeysTx, createSendTokenTx };

const FEE_DENOM = consumerChain.fees!.feeTokens[0]!.denom;

function feeAndAuth(
  pubkeyBytes: Uint8Array,
  sequence: number | bigint,
  gas: number,
  feeGranter?: string,
) {
  const pubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: Buffer.from(pubkeyBytes).toString("base64"),
  });
  // gas x the chain's minimum gas price, rounded up, with room to spare.
  const fee = coin(String(Math.ceil(gas * 0.0001) * 10), FEE_DENOM);
  return makeAuthInfoBytes([{ pubkey, sequence }], [fee], gas, feeGranter, undefined);
}

/**
 * Binds the connected Mina key to the connected Pulsar account.
 *
 * Only the Mina signature travels in the message: it proves the Mina key
 * holder agreed, and it is the one thing the transaction cannot prove by
 * itself. The Cosmos side is proven by this transaction — the chain requires
 * `creator` to be the address derived from `cosmosPublicKey`, and its body
 * carries `minaPublicKey`, so signing it IS the consent. The chain checks
 * exactly that (x/keyregistry, RegisterUserKeys).
 *
 * `minaSignature` must cover the challenge for THIS chain and THIS Mina key —
 * see keySigningChallenge. A signature over any other binding is rejected.
 */
function createRegisterKeysTx({
  sequence,
  accountNumber,
  pubkeyBytes,
  creator,
  minaPublicKey,
  minaSignature,
  feeGranter,
}: {
  sequence: number | bigint;
  accountNumber: bigint;
  pubkeyBytes: Uint8Array;
  creator: string;
  minaPublicKey: Uint8Array;
  minaSignature: Uint8Array;
  // The account paying for this transaction. A first registration has no
  // balance of its own, so the fee comes from the grant the worker issued.
  feeGranter?: string;
}): SignDoc {
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [
        {
          typeUrl: MSG_REGISTER_USER_KEYS_TYPE_URL,
          value: MsgRegisterUserKeys.encode(
            MsgRegisterUserKeys.fromPartial({
              creator,
              cosmos_public_key: Buffer.from(pubkeyBytes),
              mina_public_key: Buffer.from(minaPublicKey),
              mina_signature: Buffer.from(minaSignature),
            }),
          ).finish(),
        },
      ],
      memo: "Register Mina key with Pulsar",
    }),
  ).finish();

  return SignDoc.fromPartial({
    bodyBytes,
    authInfoBytes: feeAndAuth(pubkeyBytes, sequence, 200_000, feeGranter),
    chainId: consumerChain.chainId,
    accountNumber,
  });
}

function createSendTokenTx({
  sequence,
  accountNumber,
  pubkeyBytes,
  fromAddress,
  toAddress,
  amount,
}: {
  sequence: number | bigint;
  accountNumber: bigint;
  pubkeyBytes: Uint8Array;
  fromAddress: string;
  toAddress: string;
  amount: string;
}): SignDoc {
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: MsgSend.encode(
            MsgSend.fromPartial({
              fromAddress,
              toAddress,
              amount: [coin(amount, FEE_DENOM)],
            }),
          ).finish(),
        },
      ],
    }),
  ).finish();

  return SignDoc.fromPartial({
    bodyBytes,
    authInfoBytes: feeAndAuth(pubkeyBytes, sequence, 100_000),
    chainId: consumerChain.chainId,
    accountNumber,
  });
}
