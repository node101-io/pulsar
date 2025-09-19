import { consumerChain } from "./constants";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { Any } from "cosmjs-types/google/protobuf/any";
import { TxBody, SignDoc, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { Registry, makeAuthInfoBytes, encodePubkey, coin } from "@cosmjs/proto-signing";

import { MsgCreateKeyStore } from "@/generated/interchain_security/minakeys/tx";
import { MsgLockForWithdrawal } from "@/generated/interchain_security/bridge/tx";

const registry = new Registry();
registry.register("/cosmos.bank.v1beta1.MsgSend", MsgSend);

const cosmosTxTypeExtension = Any.fromPartial({
  typeUrl: "/interchain_security.minakeys.TxTypeExtension",
  // 0 = COSMOS_TX
  value: Uint8Array.from([8, 0]), // protobuf encoded: field 1, varint, value 0
});
const minaTxTypeExtension = Any.fromPartial({
  typeUrl:  "/interchain_security.minakeys.TxTypeExtension",
  // 1 = MINA_TX
  value: Uint8Array.from([8, 1]), // protobuf encoded: field 1, varint, value 1
});

export const createSendTokenTx = ({
  sequence,
  pubkeyBytes,
  accountNumber,
  fromAddress,
  toAddress,
  amount,
  walletType,
}: {
  sequence: number | bigint,
  pubkeyBytes: Uint8Array,
  accountNumber: bigint,
  fromAddress: string,
  toAddress: string,
  amount: string,
  walletType: 'mina' | 'cosmos'
}): SignDoc => {
  const feeAmount = coin("5000", consumerChain.fees!.feeTokens[0]!.denom);
  const gasLimit = 200_000;
  const chainId = consumerChain.chainId;

  const pubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: Buffer.from(pubkeyBytes).toString("base64"),
  });

  const bodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.encode(MsgSend.fromPartial({
        fromAddress: fromAddress,
        toAddress: toAddress,
        amount: [coin(amount, consumerChain.fees!.feeTokens[0]!.denom)],
      })).finish(),
    }],
    memo: "Sending tokens",
    extensionOptions: [walletType === 'mina' ? minaTxTypeExtension : cosmosTxTypeExtension],
  })).finish();

  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: pubkey, sequence: sequence }],
    [feeAmount],
    gasLimit,
    undefined,
    undefined,
  );

  const signDoc = SignDoc.fromPartial({
    bodyBytes,
    authInfoBytes,
    chainId,
    accountNumber: accountNumber,
  });

  return signDoc;
};

export const createKeyStoreTx = ({
  sequence,
  pubkeyBytes,
  accountNumber,
  fromAddress,
  cosmosPublicKeyHex,
  minaPublicKey,
  cosmosSignature,
  minaSignature,
}: {
  sequence: number | bigint,
  pubkeyBytes: Uint8Array,
  accountNumber: bigint,
  fromAddress: string,
  cosmosPublicKeyHex: string,
  minaPublicKey: string,
  cosmosSignature: Uint8Array,
  minaSignature: Uint8Array
}): SignDoc => {
  const feeAmount = coin("1000", consumerChain.fees!.feeTokens[0]!.denom);
  const gasLimit = 200_000;
  const chainId = consumerChain.chainId;

  const pubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: Buffer.from(pubkeyBytes).toString("base64"),
  });

  const bodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{
      typeUrl: "/interchain_security.minakeys.MsgCreateKeyStore",
      value: MsgCreateKeyStore.encode(MsgCreateKeyStore.fromPartial({
        creator: fromAddress,
        cosmosPublicKey: cosmosPublicKeyHex,
        minaPublicKey: minaPublicKey,
        cosmosSignature: Buffer.from(cosmosSignature),
        minaSignature: Buffer.from(minaSignature),
      })).finish(),
    }],
    memo: "Creating KeyStore with cross-signature validation",
    extensionOptions: [cosmosTxTypeExtension],
  })).finish();

  const authInfoBytes = makeAuthInfoBytes([{ pubkey: pubkey, sequence: sequence }], [feeAmount], gasLimit, undefined, undefined);

  const signDoc = SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId, accountNumber });

  return signDoc;
};

export const createLockForWithdrawalTx = ({
  sequence,
  pubkeyBytes,
  accountNumber,
  fromAddress,
  minaPublicKey,
  amount,
  walletType,
}: {
  sequence: number | bigint,
  pubkeyBytes: Uint8Array,
  accountNumber: bigint,
  fromAddress: string,
  minaPublicKey: string,
  amount: string,
  walletType: 'mina' | 'cosmos'
}): SignDoc => {
  const feeAmount = coin("1000", consumerChain.fees!.feeTokens[0]!.denom);
  const gasLimit = 200_000;
  const chainId = consumerChain.chainId;

  const pubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: Buffer.from(pubkeyBytes).toString("base64"),
  });

  const bodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [{
      typeUrl: "/interchain_security.bridge.MsgLockForWithdrawal",
      value: MsgLockForWithdrawal.encode(MsgLockForWithdrawal.fromPartial({
        creator: fromAddress,
        minaPublicKey,
        amount,
      })).finish(),
    }],
    memo: "Lock pMINA for withdrawal",
    extensionOptions: [walletType === 'mina' ? minaTxTypeExtension : cosmosTxTypeExtension],
  })).finish();

  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: pubkey, sequence: sequence }],
    [feeAmount],
    gasLimit,
    undefined,
    undefined,
  );

  const signDoc = SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId, accountNumber });

  return signDoc;
};
