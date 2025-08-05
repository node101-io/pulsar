import { j, publicProcedure } from "../jstack";
import { z } from "zod";
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

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

const FAUCET_AMOUNT = 10

const isValidWalletAddress = async (address: string): Promise<boolean> => {
  if (address.startsWith('B62q') && address.length === 55) {
    return true
  }

  if (address.startsWith('cosmos') && address.length > 20) {
    return true
  }

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

// TODO: Implement actual token sending
const sendTokens = async (address: string, amount: number): Promise<{ txHash: string }> => {
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))
  
  const txHash = `faucet_${Date.now()}_${Math.random().toString(36).substring(7)}`
  
  return { txHash }
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
      
      const rateLimitCheck = await checkRateLimit(walletAddress)
      console.log(rateLimitCheck)
      if (!rateLimitCheck.allowed) {
        const timeLeftHours = Math.ceil((rateLimitCheck.timeLeft || 0) / (60 * 60 * 1000))
        const timeLeftMinutes = Math.ceil(((rateLimitCheck.timeLeft || 0) % (60 * 60 * 1000)) / (60 * 1000))

        console.log(timeLeftHours, timeLeftMinutes)
        
        return c.json({
          success: false,
          error: "Rate limit exceeded",
          details: {
            timeLeft: rateLimitCheck.timeLeft,
            message: `Please wait ${timeLeftHours}h ${timeLeftMinutes}m before requesting again`
          }
        })
      }
      
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