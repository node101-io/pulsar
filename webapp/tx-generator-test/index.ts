/* eslint prettier/prettier: ["error", { "printWidth": 80 }] */

import { sha256, Random } from "@cosmjs/crypto";
import { Secp256k1 } from "@cosmjs/crypto";
import {
  encodePubkey,
  makeAuthInfoBytes,
  Registry,
} from "@cosmjs/proto-signing";
import {
  TxBody,
  TxRaw,
  SignDoc,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { Any } from "cosmjs-types/google/protobuf/any";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { coin } from "@cosmjs/launchpad";
import { bech32 } from "bech32";
import { PrivateKey, PublicKey, Signature, Field } from "o1js";

/* ---------- helpers ---------- */

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  console.log("🔄 Starting transaction generator...");
  console.log("🎲 Generating fresh keypairs...\n");

  /* ---------- generate keys ---------- */

  // 1. Generate random Cosmos keypair (for identity)
  console.log("🔑 Generating random Cosmos keypair for identity...");
  const randomCosmosPrivkey = Random.getBytes(32);
  const cosmosKeypair = await Secp256k1.makeKeypair(randomCosmosPrivkey);
  const cosmosPubkeyBytes = cosmosKeypair.pubkey;
  const cosmosPubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: bytesToBase64(cosmosPubkeyBytes),
  });

  /* Derive bech32 addr (same algorithm used by Cosmos) */
  const rawAddr = sha256(cosmosPubkeyBytes).slice(0, 20);
  const sender = bech32.encode("consumer", bech32.toWords(rawAddr));

  // 2. Generate REAL Mina keypair using o1js (for signing)
  console.log("🔐 Generating REAL Mina keypair using o1js...");
  
  // Generate real Mina private key
  const minaPrivateKey = PrivateKey.random();
  const minaPublicKey = minaPrivateKey.toPublicKey();
  
  console.log("✅ Generated Cosmos address:", sender);
  console.log("✅ Generated Mina pubkey:", minaPublicKey.toBase58());
  console.log("✅ Generated Mina privkey:", minaPrivateKey.toBase58());
  console.log(""); // Empty line

  /* ---------- tx parameters ---------- */

  const chainId = process.env.CHAIN_ID || "pulsar-devnet";
  const accountNumber = BigInt(0); // hard-coded, or query RPC
  const sequence = BigInt(0); // hard-coded, or query RPC

  const toAddress = process.env.TO_ADDRESS || "consumer1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const amount = coin(process.env.AMOUNT || "1000000", "stake"); // 1 token (6 decimals)
  const feeAmount = coin("5000", "stake"); // 0.005 stake
  const gasLimit = 200_000;
  const memo = "Bank transfer signed with REAL Mina key (o1js)";

  /* ---------- build MsgSend ---------- */

  const msgSend = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.encode(MsgSend.fromPartial({
      fromAddress: sender,
      toAddress,
      amount: [amount],
    })).finish(),
  };

  /* ---------- optional TxTypeExtension ---------- */

  const TxTypeExtensionTypeUrl = "/cosmos.minakeys.TxTypeExtension";

  const txTypeExtension = Any.fromPartial({
    typeUrl: TxTypeExtensionTypeUrl,
    // 1 = MINA_TX in your .proto enum
    value: Uint8Array.from([8, 1]), // protobuf encoded: field 1, varint, value 1
  });

  /* ---------- encode TxBody ---------- */

  const registry = new Registry();
  registry.register(msgSend.typeUrl, MsgSend);

  const txBodyEncodeObj = {
    typeUrl: "/cosmos.tx.v1beta1.TxBody",
    value: TxBody.fromPartial({
      messages: [msgSend],
      memo,
      extensionOptions: [txTypeExtension],
    }),
  };

  const txBodyBytes = TxBody.encode(txBodyEncodeObj.value).finish();

  /* ---------- encode AuthInfo ---------- */

  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: cosmosPubkey, sequence: Number(sequence) }],
    [feeAmount],
    gasLimit,
    undefined,
    undefined,
  );

  /* ---------- produce SignDoc ---------- */

  const signDoc = SignDoc.fromPartial({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    chainId,
    accountNumber: accountNumber,
  });

  const signDocBytes = SignDoc.encode(signDoc).finish();

  /* ---------- sign with REAL Mina key ---------- */

  const hashHex = sha256(signDocBytes);
  const hashString = Buffer.from(hashHex).toString("hex");

  console.log("✍️  Signing transaction with REAL Mina private key (o1js)...");
  
  // Convert hash to Mina Field for signing
  // Take first 62 hex chars (31 bytes) to fit in Field (~254 bits)
  const hashForField = "0x" + hashString.substring(0, 62);
  const messageField = Field(hashForField);
  
  // Create REAL Mina signature using o1js
  const minaSignature = Signature.create(minaPrivateKey, [messageField]);
  
  // Extract field and scalar from real Mina signature
  const fieldHex = minaSignature.r.toString();
  const scalarHex = minaSignature.s.toString();
  
  // Convert to bytes (remove 0x prefix if present)
  const fieldBytes = hexToBytes(fieldHex.replace(/^0x/, '').padStart(64, '0'));
  const scalarBytes = hexToBytes(scalarHex.replace(/^0x/, '').padStart(64, '0'));
  
  const finalSig = Uint8Array.from([...fieldBytes, ...scalarBytes]);

  console.log("🔐 Real Mina signature created!");
  console.log("   - Field (r):", fieldHex);
  console.log("   - Scalar (s):", scalarHex);

  /* ---------- assemble TxRaw ---------- */

  const txRaw = TxRaw.fromPartial({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    signatures: [finalSig],
  });

  const txRawBytes = TxRaw.encode(txRaw).finish();

  /* ---------- output ---------- */
  
  console.log("\n" + "=".repeat(60));
  console.log("🎯 TRANSACTION GENERATED SUCCESSFULLY");
  console.log("=".repeat(60));
  console.log("🔑 Generated Mina pubkey    :", minaPublicKey.toBase58());
  console.log("🔐 Generated Mina privkey   :", minaPrivateKey.toBase58());
  console.log("🏠 Generated Cosmos identity:", sender);
  console.log("📤 Sending to               :", toAddress);
  console.log("💰 Amount                   :", amount.amount, amount.denom);
  console.log("⛽ Fee                      :", feeAmount.amount, feeAmount.denom);
  console.log("🔗 Chain ID                 :", chainId);
  console.log("=".repeat(60));
  console.log("📦 Tx (base64)              :", bytesToBase64(txRawBytes));
  console.log("=".repeat(60));
  console.log(
    "\n🚀 Broadcast with:\n" +
      "curl -X POST " +
      `${process.env.RPC || "http://localhost:26657"}/broadcast_tx_commit ` +
      `-d '{"tx":"${bytesToBase64(txRawBytes)}"}'`,
  );
  console.log("\n💡 Note: Using REAL Mina keys generated with o1js!");
  console.log("🔄 Both Cosmos and Mina keypairs are fresh and authentic!");
}

// Run the main function
main().catch(console.error);
