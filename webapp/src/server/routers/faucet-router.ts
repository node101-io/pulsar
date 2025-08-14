import { j, publicProcedure } from "../jstack";
import { z } from "zod";
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { createSendTokenTx } from "@/lib/tx";
import { StargateClient } from "@cosmjs/stargate";
import { DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
import { fromHex, fromBase64 } from "@cosmjs/encoding";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { consumerChain } from "@/lib/constants";

const FAUCET_AMOUNT = 100000

if (!process.env.FAUCET_WALLET_PRIVATE_KEY)
  console.warn("⚠️  FAUCET_WALLET_PRIVATE_KEY environment variable not found.")

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN)
  console.warn("⚠️  KV_REST_API environment variables not found.")

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(1, '24h'),
  analytics: true,
})

const isValidWalletAddress = async (address: string): Promise<boolean> => {
  if (address.startsWith('B62q') && address.length === 55)
    return true

  if (address.startsWith(consumerChain.bech32Prefix!) && address.length > 20)
    return true

  return false
}

const checkRateLimit = async (address: string): Promise<{ allowed: boolean; timeLeft?: number }> => {
  try {
    const { success, reset } = await ratelimit.limit(address)

    if (success)
      return { allowed: true }

    const timeLeft = reset - Date.now()
    return { allowed: false, timeLeft: Math.max(0, timeLeft) }
  } catch (error) {
    console.error("❌ Rate limit check failed:", error)
    return { allowed: true }
  }
}

const sendTokens = async (recipientAddress: string, amount: number): Promise<{ txHash: string }> => {
  if (!process.env.FAUCET_WALLET_PRIVATE_KEY)
    throw new Error("FAUCET_WALLET_PRIVATE_KEY is not set");

  const privHex = process.env.FAUCET_WALLET_PRIVATE_KEY.trim();
  const privBytes = fromHex(privHex.startsWith("0x") ? privHex.slice(2) : privHex);

  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, consumerChain.bech32Prefix!);
  const accounts = await wallet.getAccounts();
  const faucetAccount = accounts[0];
  if (!faucetAccount)
    throw new Error("Failed to derive faucet account from private key");

  const client = await StargateClient.connect(consumerChain.apis?.rpc?.[0]?.address!);

  try {
    const faucetOnChain = await client.getAccount(faucetAccount.address);
    if (!faucetOnChain)
      throw new Error("Faucet account not found on chain");

    const signDoc = createSendTokenTx({
      sequence: faucetOnChain.sequence,
      pubkeyBytes: faucetAccount.pubkey,
      accountNumber: BigInt(faucetOnChain.accountNumber),
      fromAddress: faucetAccount.address,
      toAddress: recipientAddress,
      amount: String(amount),
      walletType: 'cosmos',
    });

    const signed = await wallet.signDirect(faucetAccount.address, signDoc);

    const protobufTx = TxRaw.encode({
      bodyBytes: signed.signed.bodyBytes,
      authInfoBytes: signed.signed.authInfoBytes,
      signatures: [fromBase64(signed.signature.signature)],
    }).finish();

    const txHash = await client.broadcastTxSync(protobufTx);
    console.log("🚀 ~ sendTokens ~ txHash:", txHash);
    return { txHash };
  } finally {
    client.disconnect();
  }
}

export const faucetRouter = j.router({
  drip: publicProcedure
    .input(z.object({
      walletAddress: z.string().min(1, "Wallet address is required")
    }))
    .mutation(async ({ input, c }) => {
      const { walletAddress } = input

      if (!(await isValidWalletAddress(walletAddress))) {
        return c.json({
          success: false,
          error: "Invalid wallet address format"
        }, 400)
      }

      // const rateLimitCheck = await checkRateLimit(walletAddress)
      // console.log(rateLimitCheck)
      // if (!rateLimitCheck.allowed) {
      //   const timeLeftHours = Math.ceil((rateLimitCheck.timeLeft || 0) / (60 * 60 * 1000))
      //   const timeLeftMinutes = Math.ceil(((rateLimitCheck.timeLeft || 0) % (60 * 60 * 1000)) / (60 * 1000))

      //   console.log(timeLeftHours, timeLeftMinutes)

      //   return c.json({
      //     success: false,
      //     error: "Rate limit exceeded",
      //     details: {
      //       timeLeft: rateLimitCheck.timeLeft,
      //       message: `Please wait ${timeLeftHours}h ${timeLeftMinutes}m before requesting again`
      //     }
      //   })
      // }

      try {
        const { txHash } = await sendTokens(walletAddress, FAUCET_AMOUNT)

        return c.json({
          success: true,
          data: {
            amount: FAUCET_AMOUNT,
            token: 'pMINA',
            walletAddress,
            txHash,
            timestamp: new Date().toISOString()
          }
        })

      } catch (error) {
        console.error("❌ Faucet error:", error)
        return c.json({
          success: false,
          error: "Failed to send tokens. Please try again."
        }, 500)
      }
    }),

  status: publicProcedure
    .input(z.object({
      walletAddress: z.string().min(1, "Wallet address is required")
    }))
    .query(async ({ input, c }) => {
      const { walletAddress } = input

      if (!(await isValidWalletAddress(walletAddress))) {
        console.log("❌ Invalid wallet address format", walletAddress)
        return c.json({
          success: false,
          error: "Invalid wallet address format"
        }, 400)
      }

      const rateLimitCheck = await checkRateLimit(walletAddress)

      return c.json({
        success: true,
        data: {
          canRequest: rateLimitCheck.allowed,
          timeLeft: rateLimitCheck.timeLeft || 0,
          faucetAmount: FAUCET_AMOUNT,
          rateLimitHours: 24
        }
      })
    })
})