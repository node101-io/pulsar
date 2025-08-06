import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { Any } from "cosmjs-types/google/protobuf/any";
import { TxBody, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { Registry, makeAuthInfoBytes, encodePubkey, coin } from "@cosmjs/proto-signing";
import grpc from '@grpc/grpc-js';
import { GrpcReflection } from 'grpc-js-reflection-client';

const userCosmosAddress = "cosmos1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const userCosmosPubkeyBytes = Uint8Array.from([2, 3, 19, 229, 165, 237, 137, 175, 162, 229, 191, 125, 200, 92, 248, 218, 22, 224, 37, 139, 77, 108, 163, 34, 225, 211, 196, 167, 236, 222, 47, 143, 47]);
const userCosmosPubkey = encodePubkey({
  type: "tendermint/PubKeySecp256k1",
  value: Buffer.from(userCosmosPubkeyBytes).toString("base64"),
});
const receiverCosmosAddress = "consumer1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const amount = coin("1000000", "pulsar"); // 1 token (6 decimals)
const feeAmount = coin("5000", "pulsar"); // 0.005 pulsar
const gasLimit = 200_000;
const chainId = "pulsar-1";






const reflectionClient = new GrpcReflection("https://cosmos-rpc.stakeandrelax.net", grpc.credentials.createSsl());

console.log('Services:', await reflectionClient.listServices());








const registry = new Registry();
registry.register("/cosmos.bank.v1beta1.MsgSend", MsgSend);




// if with mina
const txTypeExtension = Any.fromPartial({
  typeUrl:  "/cosmos.minakeys.TxTypeExtension",
  // 1 = MINA_TX
  value: Uint8Array.from([8, 1]), // protobuf encoded: field 1, varint, value 1
});




const txBodyBytes = TxBody.encode(TxBody.fromPartial({
  messages: [{
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.encode(MsgSend.fromPartial({
      fromAddress: userCosmosAddress,
      toAddress: receiverCosmosAddress,
      amount: [amount],
    })).finish(),
  }],
  memo: 'test',
  extensionOptions: [txTypeExtension],
})).finish();





const authInfoBytes = makeAuthInfoBytes(
  [{ pubkey: userCosmosPubkey, sequence: Number(BigInt(0)) }],
  [feeAmount],
  gasLimit,
  undefined,
  undefined,
);


// const signDoc = SignDoc.fromPartial({
//   bodyBytes: txBodyBytes,
//   authInfoBytes,
//   chainId,
//   accountNumber: accountNumber,
// });

// const signDocBytes = SignDoc.encode(signDoc).finish();
