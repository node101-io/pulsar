import { MINA_NODE_FALLBACK_URLS, MINA_RPC_URL } from "./constants";

/**
 * The node itself answered that it cannot serve the ledger. Thrown inside a
 * withMinaNodeFailover run this moves the read to the next daemon; surfacing
 * to a caller it means EVERY daemon declined, which is not retryable soon.
 */
export class MinaNodeNotSyncedError extends Error {}

// The daemon that last answered. Sticky on purpose: mid-outage the primary
// must not be re-probed on every balance poll, or each read eats the primary's
// timeout before reaching the daemon that works.
let activeUrl = MINA_RPC_URL;

/**
 * The daemon URL reads and transactions should go to right now, which is NOT
 * MINA_RPC_URL once a failover has moved off it. Read it per call — a copy
 * taken at startup keeps pointing at the daemon that just failed.
 */
export function activeMinaNodeUrl(): string {
  return activeUrl;
}

/**
 * Run a node-backed operation, walking the fallback list in order when it
 * throws. Browser twin of withNodeFailover in pulsar-contracts, with one
 * difference: `run` receives the URL to use, because these reads pass their
 * endpoint explicitly instead of going through a global o1js instance.
 *
 * The first attempt runs against whatever daemon last answered, so a fallback
 * that worked stays sticky for later calls. On total failure the choice
 * resets to the primary — recovery starts from the endpoint we trust most —
 * and the LAST error propagates, so an outage stays distinguishable from an
 * empty answer.
 */
export async function withMinaNodeFailover<T>(
  what: string,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const candidates = [
    activeUrl,
    ...[MINA_RPC_URL, ...MINA_NODE_FALLBACK_URLS].filter(
      (url) => url !== activeUrl,
    ),
  ];

  let lastError: unknown;
  for (const url of candidates) {
    try {
      const result = await run(url);
      activeUrl = url;
      return result;
    } catch (error) {
      lastError = error;
      console.warn(
        `${what} failed via ${url} (${
          error instanceof Error ? error.message : error
        })`,
      );
    }
  }
  activeUrl = MINA_RPC_URL;
  throw lastError;
}
