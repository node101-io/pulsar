// The Cloudflare Worker in front of the exported site.
//
// Static files are served by the ASSETS binding, which also applies
// public/_headers and public/_redirects. The only dynamic route is the MINA
// price, kept here rather than in Next so the app can export statically.

import { grantRegistrationFee, granterAddress, hasAllowance } from "./feegrant";

// Env comes from `wrangler types` (worker-configuration.d.ts), generated from
// wrangler.jsonc — run `pnpm cf-typegen` after changing bindings.
//
// DEV_ORIGIN is not one of them: the dev script passes it with --var and
// production never sets it. Optional here, so the proxy branch below is
// correctly unreachable in a deployed Worker rather than assumed present.
type WorkerEnv = Env & {
  DEV_ORIGIN?: string;
  // `wrangler secret put PULSAR_GRANTER_KEY_HEX`. Absent means the fee-grant
  // route is off rather than broken.
  PULSAR_GRANTER_KEY_HEX?: string;
};

const COINGECKO =
  "https://api.coingecko.com/api/v3/simple/price?ids=mina-protocol&vs_currencies=usd&include_24hr_change=true";

const CACHE_SECONDS = 60 * 60;

const PULSAR_RPC_ORIGIN = "https://rpc.pulsarchain.xyz";
const PULSAR_REST_ORIGIN = "https://rest.pulsarchain.xyz";


export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/price") {
      return handlePrice();
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

async function handlePrice(): Promise<Response> {
  let upstream: Response;
  try {
    // cacheEverything + cacheTtl makes Cloudflare hold the upstream response
    // at the edge, so CoinGecko sees one request per colo per 5 minutes
    // instead of one per visitor — their free tier is rate-limited by IP.
    upstream = await fetch(COINGECKO, {
      // CoinGecko 403s workerd's default User-Agent; identifying ourselves is
      // what gets the request through, not a nicety.
      headers: {
        Accept: "application/json",
        "User-Agent": "pulsar-webapp/1.0 (+https://pulsarchain.xyz)",
      },
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
    });
  } catch {
    return priceError("Could not reach the price feed", 502);
  }

  if (!upstream.ok) {
    return priceError(`Price feed returned ${upstream.status}`, 502);
  }

  const body = (await upstream.json()) as {
    "mina-protocol"?: { usd?: number; usd_24h_change?: number };
  };
  const quote = body["mina-protocol"];
  if (typeof quote?.usd !== "number") {
    return priceError("Price feed returned an unexpected shape", 502);
  }

  return Response.json(
    {
      price: Number(quote.usd.toFixed(4)),
      change24h: Number((quote.usd_24h_change ?? 0).toFixed(2)),
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        // The page is cross-origin isolated (see public/_headers); every
        // subresource it loads must opt in, including same-origin JSON.
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    },
  );
}

function priceError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
