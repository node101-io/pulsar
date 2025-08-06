/* PRODUCTION EXAMPLE - Frontend Integration */

import { sha256 } from "@cosmjs/crypto";
import { StargateClient } from "@cosmjs/stargate";
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
import { coin, coins } from "@cosmjs/stargate";
import { bech32 } from "bech32";
import { PrivateKey, PublicKey, Signature, Field } from "o1js";

/* ---------- types ---------- */

interface TransactionParams {
  fromAddress: string;      // User'ın Cosmos adresi (frontend'den)
  toAddress: string;        // Hedef adres (frontend'den)
  amount: string;           // Miktar (frontend'den)
  denom: string;            // Token tipi (frontend'den)
  memo?: string;            // Opsiyonel memo
  minaPrivateKey: string;   // User'ın Mina private key'i
  rpcEndpoint: string;      // Chain RPC endpoint
  chainId: string;          // Chain ID
}

interface FeeConfig {
  gasPrice: number;         // Gas price (e.g., 0.025)
  gasMultiplier: number;    // Safety multiplier (e.g., 1.3)
}

/* ---------- helpers ---------- */

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// Generate Cosmos keypair from Mina key (for consistency)
async function generateCosmosIdentity(minaPrivateKey: string) {
  // Use Mina key as seed for Cosmos key (deterministic)
  const minaKeyBytes = new TextEncoder().encode(minaPrivateKey);
  const hash = sha256(minaKeyBytes);
  
  const cosmosKeypair = await Secp256k1.makeKeypair(hash);
  const cosmosPubkeyBytes = cosmosKeypair.pubkey;
  const cosmosPubkey = encodePubkey({
    type: "tendermint/PubKeySecp256k1",
    value: bytesToBase64(cosmosPubkeyBytes),
  });

  const rawAddr = sha256(cosmosPubkeyBytes).slice(0, 20);
  const cosmosAddress = bech32.encode("consumer", bech32.toWords(rawAddr));
  
  return { cosmosAddress, cosmosPubkey };
}

/* ---------- main production function ---------- */

export async function createMinaSignedTransaction(
  params: TransactionParams,
  feeConfig: FeeConfig = { gasPrice: 0.025, gasMultiplier: 1.3 }
): Promise<string> {
  
  console.log("🔄 Creating production Mina-signed transaction...");

  // 1. Connect to chain
  const client = await StargateClient.connect(params.rpcEndpoint);
  
  // 2. Generate/derive Cosmos identity from Mina key
  const { cosmosAddress, cosmosPubkey } = await generateCosmosIdentity(params.minaPrivateKey);
  
  // ✅ PRODUCTION: Query real account info instead of hard-coding
  console.log("📡 Querying account information from chain...");
  const account = await client.getAccount(cosmosAddress);
  if (!account) {
    throw new Error(`Account ${cosmosAddress} not found on chain. Fund it first!`);
  }
  
  const accountNumber = BigInt(account.accountNumber);
  const sequence = BigInt(account.sequence);
  
  console.log(`✅ Account info: number=${accountNumber}, sequence=${sequence}`);

  // 3. Build transaction message
  const msgSend = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.encode(MsgSend.fromPartial({
      fromAddress: cosmosAddress,
      toAddress: params.toAddress,
      amount: [coin(params.amount, params.denom)],
    })).finish(),
  };

  // 4. Add Mina signature extension
  const txTypeExtension = Any.fromPartial({
    typeUrl: "/cosmos.minakeys.TxTypeExtension",
    value: Uint8Array.from([8, 1]), // MINA_TX = 1
  });

  // 5. Encode TxBody
  const registry = new Registry();
  registry.register(msgSend.typeUrl, MsgSend);

  const txBodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [msgSend],
    memo: params.memo || "Mina-signed transaction",
    extensionOptions: [txTypeExtension],
  })).finish();

  // ✅ PRODUCTION: Estimate gas dynamically
  console.log("⛽ Estimating gas requirements...");
  let gasLimit: number;
  let feeAmount: any;
  
  try {
    // Simulate transaction to estimate gas
    const gasEstimation = await client.simulate(
      cosmosAddress, 
      [msgSend], 
      params.memo || ""
    );
    gasLimit = Math.ceil(gasEstimation * feeConfig.gasMultiplier);
    
    const feeAmountNum = Math.ceil(gasLimit * feeConfig.gasPrice);
    feeAmount = coin(feeAmountNum.toString(), params.denom);
    
    console.log(`✅ Estimated gas: ${gasLimit}, fee: ${feeAmountNum} ${params.denom}`);
  } catch (error) {
    console.warn("⚠️  Gas estimation failed, using defaults");
    gasLimit = 200_000;
    feeAmount = coin("5000", params.denom);
  }

  // 6. Create AuthInfo
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: cosmosPubkey, sequence: Number(sequence) }],
    [feeAmount],
    gasLimit,
    undefined,
    undefined,
  );

  // 7. Create SignDoc
  const signDoc = SignDoc.fromPartial({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    chainId: params.chainId,
    accountNumber: accountNumber,
  });

  const signDocBytes = SignDoc.encode(signDoc).finish();

  // 8. Sign with user's Mina key
  console.log("✍️  Signing with user's Mina private key...");
  
  const minaPrivateKey = PrivateKey.fromBase58(params.minaPrivateKey);
  const minaPublicKey = minaPrivateKey.toPublicKey();
  
  const hashHex = sha256(signDocBytes);
  const hashString = Buffer.from(hashHex).toString("hex");
  const hashForField = "0x" + hashString.substring(0, 62);
  const messageField = Field(hashForField);
  
  const minaSignature = Signature.create(minaPrivateKey, [messageField]);
  
  const fieldHex = minaSignature.r.toString();
  const scalarHex = minaSignature.s.toString();
  
  const fieldBytes = hexToBytes(fieldHex.replace(/^0x/, '').padStart(64, '0'));
  const scalarBytes = hexToBytes(scalarHex.replace(/^0x/, '').padStart(64, '0'));
  const finalSig = Uint8Array.from([...fieldBytes, ...scalarBytes]);

  // 9. Assemble final transaction
  const txRaw = TxRaw.fromPartial({
    bodyBytes: txBodyBytes,
    authInfoBytes,
    signatures: [finalSig],
  });

  const txRawBytes = TxRaw.encode(txRaw).finish();
  const txBase64 = bytesToBase64(txRawBytes);

  console.log("🎯 Transaction created successfully!");
  console.log(`📦 From: ${cosmosAddress}`);
  console.log(`📤 To: ${params.toAddress}`);
  console.log(`💰 Amount: ${params.amount} ${params.denom}`);
  console.log(`⛽ Fee: ${feeAmount.amount} ${feeAmount.denom}`);
  console.log(`🔑 Mina pubkey: ${minaPublicKey.toBase58()}`);

  return txBase64;
}

/* ---------- frontend integration example ---------- */

export async function frontendExample() {
  try {
    // ✅ These would come from frontend form/wallet
    const params: TransactionParams = {
      fromAddress: "consumer1abc...", // Not actually needed - derived from Mina key
      toAddress: "consumer1def456...", // User input
      amount: "1000000",               // User input
      denom: "stake",                  // User selection
      memo: "Test transfer",           // User input (optional)
      minaPrivateKey: "EKF...",        // From user's Mina wallet
      rpcEndpoint: "https://cosmos-rpc.stakeandrelax.net", // Config
      chainId: "cosmoshub-4",          // Config
    };

    const txBase64 = await createMinaSignedTransaction(params);
    
    // ✅ Frontend would broadcast this
    console.log("🚀 Ready to broadcast:");
    console.log(`curl -X POST ${params.rpcEndpoint}/broadcast_tx_commit -d '{"tx":"${txBase64}"}'`);
    
    return txBase64;
  } catch (error) {
    console.error("❌ Transaction creation failed:", error);
    throw error;
  }
}

/* ---------- key management for production ---------- */

export class MinaCosmosWallet {
  private minaPrivateKey: PrivateKey;
  private cosmosAddress: string;
  private cosmosPubkey: any;

  constructor(minaPrivateKeyB58: string) {
    this.minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyB58);
  }

  async init() {
    const { cosmosAddress, cosmosPubkey } = await generateCosmosIdentity(
      this.minaPrivateKey.toBase58()
    );
    this.cosmosAddress = cosmosAddress;
    this.cosmosPubkey = cosmosPubkey;
  }

  getMinaPublicKey(): string {
    return this.minaPrivateKey.toPublicKey().toBase58();
  }

  getCosmosAddress(): string {
    return this.cosmosAddress;
  }

  async createTransaction(params: Omit<TransactionParams, 'minaPrivateKey' | 'fromAddress'>) {
    return createMinaSignedTransaction({
      ...params,
      fromAddress: this.cosmosAddress,
      minaPrivateKey: this.minaPrivateKey.toBase58(),
    });
  }
}

// Example usage:
// const wallet = new MinaCosmosWallet("user_mina_private_key_b58");
// await wallet.init();
// const tx = await wallet.createTransaction({
//   toAddress: "consumer1...",
//   amount: "1000000",
//   denom: "stake",
//   rpcEndpoint: "http://localhost:26657",
//   chainId: "test-chain"
// }); 