// The Cloudflare Worker in front of the exported site.
//
// Static files are served by the ASSETS binding, which also applies
// public/_headers and public/_redirects. The only dynamic route is the MINA
// price, kept here rather than in Next so the app can export statically.

import { grantRegistrationFee, granterAddress, hasAllowance } from "./feegrant";

// Env comes from `wrangler types` (worker-configuration.d.ts), generated from
// wrangler.jsonc — run `pnpm cf-typegen` after changing bindings. It carries
// the secrets too, because wrangler.jsonc lists them under secrets.required;
// naming them here as well would just be a second copy to drift.
//
// The declarations are still only a build-time promise — a secret nobody
// uploaded is absent at runtime whatever the type says — so both handlers
// below check before use.
//
// DEV_ORIGIN is the one exception: the dev script passes it with --var and
// production never sets it, so it is not a secret and not in that list.
// Optional here, which is what makes the proxy branch below correctly
// unreachable in a deployed Worker rather than assumed present.
type WorkerEnv = Env & {
  DEV_ORIGIN?: string;
};

const COINGECKO =
  "https://api.coingecko.com/api/v3/simple/price?ids=mina-protocol&vs_currencies=usd&include_24hr_change=true";

const CACHE_SECONDS = 60 * 60;

// How long a good quote stays usable as a fallback after the feed starts
// failing. Long, because a stale MINA price is far better than none: it only
// drives the "~$x.xx" estimate, never an amount that gets signed.
const PRICE_FALLBACK_SECONDS = 24 * 60 * 60;

// Cache API key for the last good quote. A synthetic URL — it is only ever a
// cache index, never fetched.
const PRICE_FALLBACK_KEY = "https://price-fallback.pulsar.internal/mina";

const PULSAR_RPC_ORIGIN = "https://rpc.pulsarchain.xyz";
const PULSAR_REST_ORIGIN = "https://rest.pulsarchain.xyz";


export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/price") {
      return handlePrice(env);
    }

    if (url.pathname === "/api/feegrant") {
      return handleFeegrant(request, env);
    }

    // In development everything else comes from `next dev`, so the pages keep
    // fast refresh while still being reached through this Worker — the price
    // route and the real request path are the ones that ship.
    if (env.DEV_ORIGIN) {
      return proxyToDevServer(request, url, env.DEV_ORIGIN);
    }

    return env.ASSETS.fetch(request);
  },

  // One grant at a time (max_concurrency 1 in wrangler.jsonc): the granter has
  // a single account sequence, so parallel signing would fail all but one.
  async queue(batch: MessageBatch<{ address: string }>, env: WorkerEnv): Promise<void> {
    for (const message of batch.messages) {
      if (!env.PULSAR_GRANTER_KEY_HEX) {
        message.ack();
        continue;
      }

      const result = await grantRegistrationFee(
        message.body.address,
        env.PULSAR_GRANTER_KEY_HEX,
        PULSAR_RPC_ORIGIN,
        PULSAR_REST_ORIGIN,
      );

      if (result.status === "error") {
        console.error("fee grant failed", message.body.address, result.message);
        message.retry();
        continue;
      }
      message.ack();
    }
  },
} satisfies ExportedHandler<WorkerEnv, { address: string }>;

async function proxyToDevServer(
  request: Request,
  url: URL,
  origin: string,
): Promise<Response> {
  const target = new URL(url.pathname + url.search, origin);

  let upstream: Response;
  try {
    upstream = await fetch(new Request(target, request));
  } catch {
    return new Response(
      `Cannot reach the Next dev server at ${origin}. Is it running?`,
      { status: 502, headers: { "Content-Type": "text/plain" } },
    );
  }

  // Fast refresh runs over a WebSocket; a normal Response would drop it and
  // the page would silently stop reloading on edits.
  if (upstream.webSocket) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
      webSocket: upstream.webSocket,
    });
  }

  return upstream;
}

// A new Pulsar address cannot sign its own registration: it has no account
// yet, and no way to pay for one. Granting an allowance creates the account
// and covers that single transaction.
//
// Grants are queued rather than issued inline because they all spend from one
// account, and two signed with the same sequence number cannot both land. The
// queue runs one at a time; POST enqueues, GET reports whether the chain has
// the grant yet.
async function handleFeegrant(request: Request, env: WorkerEnv): Promise<Response> {
  if (!env.PULSAR_GRANTER_KEY_HEX) {
    return Response.json({ error: "Fee grants are not configured" }, { status: 503 });
  }

  let granter: string;
  try {
    granter = await granterAddress(env.PULSAR_GRANTER_KEY_HEX);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }

  if (request.method === "GET") {
    const address = new URL(request.url).searchParams.get("address");
    if (!address) return Response.json({ error: "Expected an address" }, { status: 400 });

    const ready = await hasAllowance(PULSAR_REST_ORIGIN, granter, address);
    return Response.json({ status: ready ? "ready" : "pending", granter });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "GET or POST only" }, { status: 405 });
  }

  let address: unknown;
  try {
    ({ address } = (await request.json()) as { address?: unknown });
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (typeof address !== "string" || !address) {
    return Response.json({ error: "Expected an address" }, { status: 400 });
  }

  // Already granted: skip the queue so a returning user is not made to wait.
  if (await hasAllowance(PULSAR_REST_ORIGIN, granter, address)) {
    return Response.json({ status: "ready", granter });
  }

  await env.FEEGRANT_QUEUE.send({ address });
  return Response.json({ status: "pending", granter });
}

/**
 * The MINA quote, with the feed's rate limit designed around rather than
 * hoped away.
 *
 * CoinGecko's keyless tier is throttled per client IP, and a Worker's egress
 * IPs are shared with every other Worker on the platform — so the 429 arrives
 * because of strangers' traffic, not ours, and no amount of edge caching on
 * our side prevents it. Two things follow:
 *
 *   1. COINGECKO_API_KEY is required, not a nicety: it moves the quota from
 *      that shared IP onto our own account. A free Demo key is enough. An
 *      unkeyed deploy does not degrade, it 429s on someone else's traffic.
 *   2. A failed fetch falls back to the last good quote instead of surfacing
 *      an error, because a price this app only uses for a "~$x.xx" estimate
 *      should never be the reason the screen looks broken.
 */
async function handlePrice(env: WorkerEnv): Promise<Response> {
  // A named cache, not caches.default: the default one already holds the
  // CoinGecko response that cf.cacheEverything put there, and the fallback
  // should not share a namespace with it.
  const cache = await caches.open("price-fallback");
  const fallbackKey = new Request(PRICE_FALLBACK_KEY);

  // Typed as required, but a secret is only ever present at runtime. A missing
  // one is an operator error, so say so plainly rather than firing a request
  // that is guaranteed to be throttled — while still serving a stale quote if
  // there is one, since the misconfiguration is not the visitor's problem.
  if (!env.COINGECKO_API_KEY) {
    return (
      (await cache.match(fallbackKey)) ??
      Response.json(
        { error: "Price feed is not configured" },
        { status: 500 },
      )
    );
  }

  let upstream: Response | undefined;
  try {
    // cacheEverything + cacheTtl holds the upstream response at the edge, so
    // CoinGecko sees one request per colo per CACHE_SECONDS rather than one
    // per visitor. It bounds OUR share of the quota; it cannot bound anyone
    // else's on the same egress IP.
    upstream = await fetch(COINGECKO, {
      headers: {
        Accept: "application/json",
        // CoinGecko 403s workerd's default User-Agent; identifying ourselves
        // is what gets the request through, not a nicety.
        "User-Agent": "pulsar-webapp/1.0 (+https://pulsarchain.xyz)",
        "x-cg-demo-api-key": env.COINGECKO_API_KEY,
      },
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
    });
  } catch {
    // Network failure: nothing to read, go straight to the fallback.
  }

  const quote = upstream?.ok ? await readQuote(upstream) : undefined;

  if (!quote) {
    const stale = await cache.match(fallbackKey);
    if (stale) return stale;

    const reason = !upstream
      ? "Could not reach the price feed"
      : !upstream.ok
        ? `Price feed returned ${upstream.status}`
        : "Price feed returned an unexpected shape";
    return Response.json({ error: reason }, { status: 502 });
  }

  const response = Response.json(quote, {
    headers: {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      // The page is cross-origin isolated (see public/_headers); every
      // subresource it loads must opt in, including same-origin JSON.
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });

  // Keep this quote as the fallback. Its own max-age is what decides how long
  // the Cache API will still hand it back, so it is set independently of the
  // max-age the browser sees.
  const fallback = new Response(response.clone().body, response);
  fallback.headers.set("Cache-Control", `public, max-age=${PRICE_FALLBACK_SECONDS}`);
  await cache.put(fallbackKey, fallback);

  return response;
}

async function readQuote(
  upstream: Response,
): Promise<{ price: number; change24h: number } | undefined> {
  let body: { "mina-protocol"?: { usd?: number; usd_24h_change?: number } };
  try {
    body = await upstream.json();
  } catch {
    return undefined;
  }

  const quote = body["mina-protocol"];
  if (typeof quote?.usd !== "number") return undefined;

  return {
    price: Number(quote.usd.toFixed(4)),
    change24h: Number((quote.usd_24h_change ?? 0).toFixed(2)),
  };
}
