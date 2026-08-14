import {
  BRIDGE_MODULE_ADDRESS,
  MINA_RPC_URL,
  PMINA_DENOM,
  PULSAR_REST_URL,
  PULSAR_RPC_URL,
} from "./constants";
import {
  BRIDGE_QUERY_LATEST_ACTION_HASHES,
  BRIDGE_QUERY_PARAMS,
  BridgeQueryParamsRequest,
  BridgeQueryParamsResponse,
  QueryLatestActionHashesRequest,
  QueryLatestActionHashesResponse,
} from "pulsar-chain-client/messages";
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { consumerChain } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A Pulsar account's pMINA, in base units.
 *
 * Base units and not a token float: the node reports an exact integer, and
 * dividing it here would hand every caller a value they cannot compare against
 * a typed amount without reintroducing float error. lib/amount.ts converts at
 * the point of display instead.
 */
export const fetchPminaBalance = async (account: string): Promise<bigint> => {
  const balance = await fetch(`${PULSAR_REST_URL}/cosmos/bank/v1beta1/balances/${account}`);
  const json = await balance.json() as { balances: { denom: string, amount: string }[] };
  const raw = json.balances.find(item => item.denom === PMINA_DENOM)?.amount;
  // The node answers in whole base units. Anything else is a response we do not
  // understand, and guessing at it would be worse than reading zero.
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
};

export type BridgeTransfer = {
  // A single push settles many accounts and can credit one of them twice, so
  // the transaction hash alone does not identify a row.
  id: string;
  direction: "deposit" | "withdraw";
  /** The user side of the movement — who was credited, or whose burn it was. */
  account: string;
  // Base units (pmina).
  amount: bigint;
  height: number;
  // RFC3339, as the node reports it.
  timestamp: string;
  txHash: string;
};

type RestEvent = { type: string; attributes: { key: string; value: string }[] };

type RestTxResponse = {
  txhash: string;
  height: string;
  timestamp: string;
  code: number;
  events?: RestEvent[];
};

const BRIDGE_TRANSFER_PAGE_SIZE = 100;

/** "12000000000pmina", or a comma-joined coin list containing one. */
function parsePminaAmount(raw: string | undefined): bigint | null {
  if (!raw) return null;
  for (const coin of raw.split(",")) {
    if (!coin.endsWith(PMINA_DENOM)) continue;
    const digits = coin.slice(0, -PMINA_DENOM.length);
    if (/^\d+$/.test(digits)) return BigInt(digits);
  }
  return null;
}

/**
 * One direction of bridge movement — everyone's, or one account's when
 * `account` is given.
 *
 * The query is anchored on the MODULE side of the `transfer` event, which is
 * what makes the global read possible at all: a deposit credit is the one
 * transfer FROM the module account, a withdrawal burn the one transfer TO it,
 * so the module's side plus a direction enumerates every bridge movement on
 * the chain. The user side is then read off each matched event rather than
 * queried for.
 *
 * When both sides are in the query they are matched on the SAME `transfer`
 * event, which is not a stylistic choice: this chain's indexer only ANDs
 * conditions that belong to one event type. `transfer.sender AND
 * transfer.recipient` resolves, while `transfer.sender AND message.module`
 * returns an empty list even for a transaction that satisfies both —
 * silently, with no error. Do not add a message.action clause to "narrow"
 * this; it returns nothing.
 */
async function fetchDirectionalTransfers(
  direction: BridgeTransfer["direction"],
  account?: string,
): Promise<BridgeTransfer[]> {
  const moduleSide = direction === "deposit" ? "sender" : "recipient";
  const userSide = direction === "deposit" ? "recipient" : "sender";

  const conditions = [`transfer.${moduleSide}='${BRIDGE_MODULE_ADDRESS}'`];
  if (account) conditions.push(`transfer.${userSide}='${account}'`);

  const params = new URLSearchParams({
    query: conditions.join(" AND "),
    limit: String(BRIDGE_TRANSFER_PAGE_SIZE),
    order_by: "ORDER_BY_DESC",
  });

  const res = await fetch(`${PULSAR_REST_URL}/cosmos/tx/v1beta1/txs?${params}`);
  if (!res.ok) throw new Error(`Could not read bridge history (${res.status})`);

  const { tx_responses: responses = [] } = (await res.json()) as {
    tx_responses?: RestTxResponse[];
  };

  return responses.flatMap((tx) => {
    // A reverted push moves nothing, but its events are indexed all the same.
    if (tx.code !== 0) return [];

    return (tx.events ?? []).flatMap((event, index) => {
      if (event.type !== "transfer") return [];

      // The query matched the transaction, not this event: the same push also
      // carries every other account it settled, plus the pusher's fee.
      const attrs = Object.fromEntries(event.attributes.map((a) => [a.key, a.value]));
      if (attrs[moduleSide] !== BRIDGE_MODULE_ADDRESS) return [];
      const eventAccount = attrs[userSide];
      if (!eventAccount) return [];
      if (account && eventAccount !== account) return [];

      const amount = parsePminaAmount(attrs.amount);
      if (amount === null) return [];

      return [{
        id: `${tx.txhash}-${index}`,
        direction,
        account: eventAccount,
        amount,
        height: Number(tx.height),
        timestamp: tx.timestamp,
        txHash: tx.txhash,
      }];
    });
  });
}

/**
 * Bridge history for one Pulsar account, newest first.
 *
 * Two requests, not one: the query language has no OR, so each direction is
 * its own round trip. They are independent and run together.
 *
 * This only ever shows the Pulsar leg. The Mina deposit that caused a credit
 * is not recoverable from here — the action's Mina height is consumed by the
 * keeper and never reaches an event — so a deposit is invisible until the
 * chain settles it, roughly two hours after the user sends it.
 */
export async function fetchBridgeTransfers(address: string): Promise<BridgeTransfer[]> {
  const [deposits, withdrawals] = await Promise.all([
    fetchDirectionalTransfers("deposit", address),
    fetchDirectionalTransfers("withdraw", address),
  ]);

  return [...deposits, ...withdrawals].sort((a, b) => b.height - a.height);
}

/**
 * Every account's bridge movements, newest first — the public feed. The most
 * recent page of each direction; a movement older than both pages is not
 * shown, which for a feed is the right kind of incomplete.
 */
export async function fetchAllBridgeTransfers(): Promise<BridgeTransfer[]> {
  const [deposits, withdrawals] = await Promise.all([
    fetchDirectionalTransfers("deposit"),
    fetchDirectionalTransfers("withdraw"),
  ]);

  return [...deposits, ...withdrawals].sort((a, b) => b.height - a.height);
}

export const formatTimeLeft = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

export const waitForTxCommit = async (txHashHex: string): Promise<any> => {
  const timeoutMs = 90_000;
  const pollIntervalMs = 1_500;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${consumerChain.apis?.rpc?.[0]?.address}/tx?hash=0x${txHashHex}`);
      if (res.ok) {
        const json: any = await res.json();
        const result = json?.result;
        if (result && result.height && Number(result.height) > 0) {
          const code = result?.tx_result?.code;
          if (typeof code === 'number' && code > 0) {
            const rawLog = result?.tx_result?.log || result?.tx_result?.info || 'Transaction failed';
            throw new Error(rawLog, { cause: 31 });
          }
          return result;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.cause === 31)
        throw new Error(error.message);

      // ignore and keep polling
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Transaction not confirmed in time');
};


/**
 * Account number and sequence for building a sign doc.
 *
 * Read over REST rather than through the wallet's signing client: the client
 * type no longer exposes them, and this is the same value the chain checks
 * the signature against.
 */
export async function fetchAccountAuth(
  address: string,
): Promise<{ accountNumber: bigint; sequence: number }> {
  const res = await fetch(
    `${PULSAR_REST_URL}/cosmos/auth/v1beta1/accounts/${address}`,
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "This Pulsar account does not exist yet — it needs a first transaction or a funded balance."
        : `Failed to read account: ${res.status}`,
    );
  }

  const data = (await res.json()) as {
    account?: { account_number?: string; sequence?: string };
  };
  if (!data.account?.account_number) {
    throw new Error("Account response did not carry an account number");
  }

  return {
    accountNumber: BigInt(data.account.account_number),
    sequence: Number(data.account.sequence ?? "0"),
  };
}

export type MinaPrice = { price: number; change24h: number };

/**
 * MINA/USD, for the estimate shown next to an amount. Served by the same
 * Cloudflare Worker that serves this app (see webapp/worker/index.ts): the
 * upstream is rate-limited per IP, so one cached edge response serves everyone
 * instead of every visitor calling CoinGecko themselves.
 */
export async function fetchMinaPrice(): Promise<MinaPrice> {
  const res = await fetch("/api/price");
  if (!res.ok) throw new Error(`Failed to read MINA price: ${res.status}`);
  return (await res.json()) as MinaPrice;
}

/**
 * The Pulsar chain's current block height.
 *
 * Recorded against a pending deposit as the watermark that later tells a
 * settled credit apart from one that was already there. A height and not a
 * timestamp on purpose: both sides of that comparison then come from the same
 * monotonic chain clock, so a browser whose clock is minutes off cannot make a
 * settled deposit look unsettled — or, far worse, an old one look new.
 */
export async function fetchPulsarHeight(): Promise<number> {
  const res = await fetch(`${PULSAR_RPC_URL}/status`);
  if (!res.ok) throw new Error(`Pulsar RPC returned ${res.status}`);

  const body = (await res.json()) as {
    result?: { sync_info?: { latest_block_height?: string } };
  };
  const height = Number(body.result?.sync_info?.latest_block_height);
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new Error("Pulsar RPC returned no block height");
  }
  return height;
}

/**
 * Mina's current block height, read from the same node the deposit is sent to.
 *
 * A deposit lands at some height above this one, which makes it a sound lower
 * bound for progress: until the chain's scan cursor passes it, the deposit
 * certainly has not been read yet.
 */
export async function fetchMinaHeight(): Promise<number> {
  const res = await fetch(MINA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "{ bestChain(maxLength: 1) { protocolState { consensusState { blockHeight } } } }",
    }),
  });
  if (!res.ok) throw new Error(`Mina node returned ${res.status}`);

  const body = (await res.json()) as {
    data?: {
      bestChain?: {
        protocolState?: { consensusState?: { blockHeight?: string } };
      }[];
    };
  };
  const height = Number(
    body.data?.bestChain?.[0]?.protocolState?.consensusState?.blockHeight,
  );
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new Error("Mina node returned no block height");
  }
  return height;
}

/**
 * How far into Mina the chain has scanned (x/bridge, inclusive upper cursor).
 *
 * This is the honest answer to "where is my deposit": every credit waits on
 * this number reaching the block that carried it. A flat "about two hours"
 * cannot tell a busy bridge from a stopped one; this can.
 */
export async function fetchMinaScanCursor(): Promise<number> {
  const request = QueryLatestActionHashesRequest.encode(
    QueryLatestActionHashesRequest.fromPartial({}),
  ).finish();

  const value = await abciQuery(BRIDGE_QUERY_LATEST_ACTION_HASHES, request);
  const { latest_fetched_mina_height: cursor } =
    QueryLatestActionHashesResponse.decode(value);

  // The codec types this int64 as an optional string, so an absent field would
  // reach callers as NaN — which compares false against everything and would
  // render as confident progress the chain never reported. Fail instead.
  const height = Number(cursor);
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error("Pulsar reported no Mina scan cursor");
  }
  return height;
}

/**
 * How many blocks past a Mina block the tip must be before the chain reads
 * it (x/bridge params.confirmation_depth).
 *
 * This single number is most of the bridge's latency, which is why the UI
 * fetches it instead of hard-coding "about two hours": with it, a pending
 * transfer's wait splits into "Mina is still confirming the block" and
 * "Pulsar's scan is behind" — different problems with different owners.
 */
export async function fetchBridgeConfirmationDepth(): Promise<number> {
  const request = BridgeQueryParamsRequest.encode(
    BridgeQueryParamsRequest.fromPartial({}),
  ).finish();

  const value = await abciQuery(BRIDGE_QUERY_PARAMS, request);
  const depth = Number(
    BridgeQueryParamsResponse.decode(value).params?.confirmation_depth,
  );
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new Error("Pulsar reported no confirmation depth");
  }
  return depth;
}

// Cosmos SDK error code that /abci_query reports in `codespace: "sdk"` when a
// keeper lookup misses. Anything else is a real failure, not an answer.
export const SDK_ERR_KEY_NOT_FOUND = 22;

export class AbciQueryError extends Error {
  constructor(readonly code: number, readonly log: string) {
    super(log || `abci query failed with code ${code}`);
    this.name = "AbciQueryError";
  }
}

/**
 * A gRPC query issued over Tendermint's JSON-RPC.
 *
 * Not the REST gateway: it takes `bytes` fields as base64 inside a URL *path
 * segment*, and a Mina public key's base64 contains "/" about three quarters
 * of the time. That splits the path, the gateway matches no route, and answers
 * 501 — indistinguishable from the module being missing. Here the request is
 * hex in a query string, so no key is unaddressable.
 *
 * Requires `cors_allowed_origins` in the node's config.toml: CometBFT's RPC
 * sends no Access-Control-Allow-Origin by default and the browser drops the
 * response without it.
 */
export async function abciQuery(
  path: string,
  request: Uint8Array,
): Promise<Uint8Array> {
  const hex = Array.from(request)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const url = `${PULSAR_RPC_URL}/abci_query?path=${encodeURIComponent(
    `"${path}"`,
  )}&data=0x${hex}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pulsar RPC returned ${res.status}`);

  const body = (await res.json()) as {
    error?: { message?: string };
    result?: { response?: { code?: number; log?: string; value?: string } };
  };
  if (body.error) throw new Error(body.error.message ?? "Pulsar RPC error");

  const response = body.result?.response;
  if (!response) throw new Error("Pulsar RPC returned no response");

  const code = response.code ?? 0;
  if (code !== 0) throw new AbciQueryError(code, response.log ?? "");

  return response.value
    ? Uint8Array.from(Buffer.from(response.value, "base64"))
    : new Uint8Array();
}

export type FeeGrant = { granter: string };

type FeeGrantResponse = { status?: "ready" | "pending"; granter?: string; error?: string };

const FEE_GRANT_TIMEOUT_MS = 90_000;
const FEE_GRANT_POLL_MS = 2_000;

/**
 * Has the worker cover this address's registration fee, and waits until the
 * chain agrees it is covered.
 *
 * Registration is the one transaction a user cannot pay for: the account does
 * not exist until something touches it, and an unknown signer is rejected
 * before any fee is even considered. The grant creates the account and pays
 * for that single message; everything after it the user funds themselves from
 * their deposits.
 *
 * The worker queues grants — they all spend from one account, so they cannot
 * be signed in parallel — which is why this polls rather than getting an
 * answer outright.
 */
export async function requestFeeGrant(address: string): Promise<FeeGrant> {
  const queued = await postFeeGrant(address);
  if (queued.status === "ready") return { granter: queued.granter };

  const deadline = Date.now() + FEE_GRANT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FEE_GRANT_POLL_MS));

    const res = await fetch(
      `/api/feegrant?address=${encodeURIComponent(address)}`,
    );
    const body = (await res.json()) as FeeGrantResponse;
    if (!res.ok) throw new Error(body.error ?? `Fee grant failed: ${res.status}`);
    if (body.status === "ready" && body.granter) return { granter: body.granter };
  }

  throw new Error(
    "Timed out waiting for the fee grant. Please try registering again.",
  );
}

async function postFeeGrant(
  address: string,
): Promise<{ status: "ready" | "pending"; granter: string }> {
  const res = await fetch("/api/feegrant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  const body = (await res.json()) as FeeGrantResponse;
  if (!res.ok) throw new Error(body.error ?? `Fee grant failed: ${res.status}`);
  if (!body.granter) throw new Error("Fee grant response carried no granter");

  return { status: body.status === "ready" ? "ready" : "pending", granter: body.granter };
}
