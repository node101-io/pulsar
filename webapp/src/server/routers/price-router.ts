import { j, publicProcedure } from "../jstack"

let priceCache: {
  price: number
  change24h: number
  lastUpdated: number
} | null = null

const CACHE_DURATION = 5 * 60 * 1000

const fetchMinaPrice = async (): Promise<{ price: number; change24h: number }> => {
  const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price?ids=mina-protocol&vs_currencies=usd&include_24hr_change=true"

  try {
    const response = await fetch(COINGECKO_API, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Pulsar-Web/1.0.0',
      },
    })

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as Record<string, any>

    const minaData = data['mina-protocol']

    if (!minaData || typeof minaData.usd !== 'number') {
      throw new Error('Invalid response structure from CoinGecko API')
    }

    const price = Number(minaData.usd.toFixed(4))
    const change24h = Number((minaData.usd_24h_change || 0).toFixed(2))

    return { price, change24h }

  } catch (error) {
    console.error("❌ CoinGecko API error:", error)
    throw new Error(`Failed to fetch MINA price from CoinGecko: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const priceRouter = j.router({
  mina: publicProcedure.query(async ({ c }) => {
    try {
      const now = Date.now()

      if (priceCache && (now - priceCache.lastUpdated) < CACHE_DURATION) {
        return c.superjson({
          success: true,
          data: {
            price: priceCache.price,
            change24h: priceCache.change24h,
            cached: true,
            lastUpdated: priceCache.lastUpdated
          }
        })
      }

      const { price, change24h } = await fetchMinaPrice()

      priceCache = {
        price,
        change24h,
        lastUpdated: now
      }

      return c.superjson({
        success: true,
        data: {
          price,
          change24h,
          cached: false,
          lastUpdated: now
        }
      })

    } catch (error) {
      if (priceCache) {
        return c.superjson({
          success: true,
          data: {
            price: priceCache.price,
            change24h: priceCache.change24h,
            cached: true,
            stale: true,
            lastUpdated: priceCache.lastUpdated
          }
        })
      }

      throw new Error("Failed to fetch MINA price and no cached data available")
    }
  }),
})