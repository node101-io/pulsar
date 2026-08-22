import { fetchLastBlock, Field, Mina, PublicKey, UInt32 } from 'o1js';
import { log } from './loggers.js';
import { PulsarAction } from '../types/PulsarAction.js';
import { CalculateFinalActionState } from './actionQueueUtils.js';
import { ARCHIVE_FALLBACKS, ENDPOINTS, NODE_FALLBACKS } from './constants.js';
import { SettlementContract, SettlementEvent } from '../SettlementContract.js';

export {
  activeNodeEndpoint,
  checkZkappTransaction,
  fetchActions,
  fetchRawActions,
  fetchBlockHeight,
  fetchEvents,
  setMinaNetwork,
  sliceActionHistory,
  waitForTransaction,
  withArchiveFailover,
  withNodeFailover,
};

// The network setMinaNetwork last configured, or null when it never ran —
// null means the active instance is caller-managed (LocalBlockchain in
// tests), where rebuilding it would clobber state and there is no fallback
// archive to reach anyway.
let configuredNetwork: 'devnet' | 'mainnet' | 'lightnet' | null = null;

// Which endpoint of each pair the active instance currently points at. Both
// failovers rebuild the same o1js instance, so each has to preserve the
// other's choice: a node failover that reset the archive would undo a
// mid-outage archive fallback, and vice versa.
let activeNodeUrl: string | null = null;
let activeArchiveUrl: string | null = null;

function useEndpoints(nodeUrl: string, archiveUrl: string) {
  activeNodeUrl = nodeUrl;
  activeArchiveUrl = archiveUrl;
  Mina.setActiveInstance(Mina.Network({ mina: nodeUrl, archive: archiveUrl }));
}

function useArchiveEndpoint(archiveUrl: string) {
  useEndpoints(activeNodeUrl ?? ENDPOINTS.NODE[configuredNetwork!], archiveUrl);
}

function useNodeEndpoint(nodeUrl: string) {
  useEndpoints(
    nodeUrl,
    activeArchiveUrl ?? ENDPOINTS.ARCHIVE[configuredNetwork!]
  );
}

/**
 * The daemon URL the active instance is pointed at right now, which is NOT
 * ENDPOINTS.NODE[network] once a failover has moved off the primary. Callers
 * that talk to the node outside o1js (checkZkappTransaction, and anything
 * else taking an `endpoint` string) must read it per call rather than
 * capturing it at startup, or they keep polling the endpoint that just failed.
 */
function activeNodeEndpoint(
  network: 'devnet' | 'mainnet' | 'lightnet' = 'devnet'
) {
  return activeNodeUrl ?? ENDPOINTS.NODE[network];
}

/**
 * Run an endpoint-backed operation, walking the kind's fallback list in
 * order when it fails. Sequential on purpose — o1js's own multi-endpoint
 * support races endpoints in pairs and a fast-failing primary wins the race
 * (see the ARCHIVE_FALLBACKS comment in constants.ts).
 *
 * The first attempt runs against whatever endpoint the active instance
 * already points at, so a fallback that worked stays sticky for later calls
 * (mid-outage the primary is not re-probed on every fetch). On total failure
 * the instance is reset to the primary and the LAST error propagates —
 * swallowing it into an empty result would make an outage indistinguishable
 * from a genuinely empty answer.
 *
 * `run` must therefore re-read its endpoint on every attempt — through the
 * active o1js instance (fetchAccount, fetchActions, tx send) or via
 * activeNodeEndpoint(). A closure over a URL captured before the first
 * attempt retries the dead endpoint N times and reports the fallback as
 * broken too.
 */
async function withEndpointFailover<T>(
  kind: 'node' | 'archive',
  what: string,
  run: () => Promise<T>
): Promise<T> {
  const [fallbacks, primary, activate] =
    kind === 'node'
      ? ([NODE_FALLBACKS, ENDPOINTS.NODE, useNodeEndpoint] as const)
      : ([ARCHIVE_FALLBACKS, ENDPOINTS.ARCHIVE, useArchiveEndpoint] as const);

  let lastError: unknown;
  try {
    return await run();
  } catch (error) {
    lastError = error;
  }
  if (configuredNetwork !== null) {
    for (const url of fallbacks[configuredNetwork]) {
      console.warn(
        `${what} failed (${
          lastError instanceof Error ? lastError.message : lastError
        }), retrying via fallback ${kind} ${url}`
      );
      activate(url);
      try {
        return await run();
      } catch (error) {
        lastError = error;
      }
    }
    activate(primary[configuredNetwork]);
  }
  throw lastError;
}

/**
 * Archive failover, born in the 2026-08-15 Minascan archive outage. Archive
 * data needs no trust — callers refold every slice against the contract's
 * on-chain actionState — so trying alternates is always safe.
 */
async function withArchiveFailover<T>(
  what: string,
  run: () => Promise<T>
): Promise<T> {
  return withEndpointFailover('archive', what, run);
}

/**
 * Daemon failover, born in the 2026-08-22 Minascan node outage (BOOTSTRAP:
 * every account read answered null). Unlike archive reads, node reads are
 * taken on trust — see the NODE_FALLBACKS comment in constants.ts for why
 * the list stays short.
 *
 * Note what this cannot catch: a daemon that answers happily from an
 * incomplete ledger. o1js reports the BOOTSTRAP null-account as "Could not
 * find account", so the failover fires — but a caller that maps a missing
 * account onto "empty" instead of onto an error swallows the outage before
 * it ever reaches here.
 */
async function withNodeFailover<T>(
  what: string,
  run: () => Promise<T>
): Promise<T> {
  return withEndpointFailover('node', what, run);
}

async function fetchRawActions(
  address: PublicKey,
  fromActionState?: Field,
  endActionState?: Field
) {
  return withArchiveFailover('Action fetch', async () => {
    const result = await Mina.fetchActions(address, {
      fromActionState,
      endActionState,
    });

    log('Fetched actions:', JSON.stringify(result), null, 2);

    if (!Array.isArray(result)) {
      throw new Error(
        `Error fetching actions: ${JSON.stringify(result.error)}`
      );
    }
    return result;
  });
}

/**
 * Every archive entry carries `hash` = the true action state AFTER applying
 * that entry, so any returned slice can be verified locally: refold from
 * `fromActionState` and require every step to land on the entry's own hash.
 * A coherent chain that merely starts in the wrong place cannot pass either,
 * because the first fold from OUR fromActionState would miss its hash.
 */
function sliceIsCoherent(
  rawActions: { actions: string[][]; hash: string }[],
  fromActionState: Field
): boolean {
  let state = fromActionState;
  for (const entry of rawActions) {
    state = CalculateFinalActionState(state, [
      PulsarAction.fromRawAction(entry.actions[0]),
    ]);
    if (state.toString() !== entry.hash) return false;
  }
  return true;
}

async function fetchActions(
  address: PublicKey,
  fromActionState: Field,
  endActionState?: Field
) {
  let rawActions = await fetchRawActions(
    address,
    fromActionState,
    endActionState
  );

  if (rawActions.length === 0 || !sliceIsCoherent(rawActions, fromActionState)) {
    // The archive cannot be trusted to slice at a mid-block fromActionState —
    // e.g. a BATCH_SIZE cut inside a block that carried several dispatches.
    // Seen live in both flavors: an empty result, and (o1test, 2026-08-16) a
    // NON-empty but incomplete subset that only the coherence refold above
    // catches. Either way: refetch the full history and slice locally on the
    // per-action hash chain; callers still verify the slice by refolding it
    // against the account's stored action states, so a bad slice can never
    // prove.
    rawActions = sliceActionHistory(
      await fetchRawActions(address),
      fromActionState,
      endActionState
    );
  }

  if (rawActions.length === 0) {
    console.warn('No actions found for the given address and state range.');
    return [];
  }

  return rawActions.map((action) => {
    return {
      action: PulsarAction.fromRawAction(action.actions[0]),
      hash: BigInt(action.hash),
    };
  });
}

/**
 * Cut a full per-action history (one entry per action, `hash` = the action
 * state AFTER applying it) down to the (fromActionState, endActionState]
 * range. States that are not on the chain throw instead of degrading into an
 * empty or over-wide result: both point at archive lag or inconsistency the
 * caller must not paper over.
 */
function sliceActionHistory(
  history: { actions: string[][]; hash: string }[],
  fromActionState: Field,
  endActionState?: Field
) {
  const from = fromActionState.toString();
  const cut = history.findIndex((entry) => entry.hash === from);
  if (cut === -1 && history.length > 0) {
    throw new Error(
      `fromActionState ${from} is not on the fetched action chain — ` +
        `archive is lagging or inconsistent`
    );
  }
  let sliced = history.slice(cut + 1);
  if (endActionState !== undefined) {
    const end = endActionState.toString();
    const endIndex = sliced.findIndex((entry) => entry.hash === end);
    if (endIndex === -1) {
      throw new Error(
        `endActionState ${end} is not on the fetched action chain after ` +
          `${from} — archive is lagging or inconsistent`
      );
    }
    sliced = sliced.slice(0, endIndex + 1);
  }
  return sliced;
}

async function fetchBlockHeight(
  network: 'devnet' | 'mainnet' | 'lightnet' = 'devnet'
) {
  try {
    return await withNodeFailover('Block height fetch', async () => {
      const lastBlock = await fetchLastBlock(activeNodeEndpoint(network));

      return Number(lastBlock.blockchainLength.toBigint());
    });
  } catch (error) {
    console.error('Error fetching block height:', error);
    throw error;
  }
}

async function fetchEvents(
  contractInstance: SettlementContract,
  from: UInt32 = UInt32.from(0),
  to?: UInt32
) {
  try {
    // Events come from the archive too — same failover as actions.
    const result = await withArchiveFailover('Event fetch', () =>
      contractInstance.fetchEvents(from, to)
    );
    const events = result
      .map((item) => item.event.data as any)
      .map(
        (data) =>
          new SettlementEvent({
            fromActionState: data.fromActionState,
            endActionState: data.endActionState,
            mask: data.mask,
          })
      );

    return events;
  } catch (error) {
    console.error('Error fetching events:', error);
    throw error;
  }
}

function setMinaNetwork(network: 'devnet' | 'mainnet' | 'lightnet' = 'devnet') {
  configuredNetwork = network;
  useEndpoints(ENDPOINTS.NODE[network], ENDPOINTS.ARCHIVE[network]);

  const nodeFallbacks = NODE_FALLBACKS[network];
  const archiveFallbacks = ARCHIVE_FALLBACKS[network];
  const listed = (fallbacks: string[]) =>
    fallbacks.length > 0
      ? ` (+${fallbacks.length} fallback(s): ${fallbacks.join(', ')})`
      : '';
  console.log(
    `Setting Mina network to ${network}, ` +
      `Mina endpoint: ${ENDPOINTS.NODE[network]}${listed(nodeFallbacks)}, ` +
      `Archive endpoint: ${ENDPOINTS.ARCHIVE[network]}${listed(
        archiveFallbacks
      )}`
  );
}

type FailureReasonResponse = {
  failures: string[];
  index: number;
}[];

type BestChainResponse = {
  bestChain: {
    transactions: {
      zkappCommands: {
        hash: string;
        failureReason: FailureReasonResponse;
      }[];
    };
  }[];
};

async function fetchLatestBlockZkappStatus(
  endpoint: string,
  blockLength = 5
): Promise<BestChainResponse> {
  const query = `
    query BestChain {
      bestChain(maxLength: ${blockLength}) {
        commandTransactionCount
        transactions {
          zkappCommands {
            hash
            failureReason {
              failures
              index
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching latest block zkApp status:', error);
    throw error;
  }
}

async function checkZkappTransaction(
  transactionHash: string,
  endpoint: string,
  blockLength = 5
) {
  let bestChainBlocks = await fetchLatestBlockZkappStatus(
    endpoint,
    blockLength
  );
  for (let block of bestChainBlocks.bestChain) {
    for (let zkappCommand of block.transactions.zkappCommands) {
      if (zkappCommand.hash === transactionHash) {
        if (zkappCommand.failureReason !== null) {
          let failureReason = zkappCommand.failureReason
            .reverse()
            .map((failure) => {
              return [failure.failures.map((failureItem) => failureItem)];
            });
          return {
            success: false,
            failureReason,
          };
        } else {
          return {
            success: true,
            failureReason: null,
          };
        }
      }
    }
  }
  return {
    success: false,
    failureReason: null,
  };
}

async function waitForTransaction(
  transactionHash: string,
  endpoint: string,
  maxAttempts: number = 60, // 10 minutes if interval is 10 seconds
  interval: number = 10000, // 10 seconds
  attempts: number = 0
): Promise<{
  success: boolean;
  failureReason: any;
}> {
  try {
    const res = await checkZkappTransaction(transactionHash, endpoint);
    if (res.success) {
      return {
        success: true,
        failureReason: null,
      };
    } else if (res.failureReason) {
      return {
        success: false,
        failureReason: res.failureReason,
      };
    }
  } catch (error) {
    // A failed poll (rate limit, transient network error) says nothing about
    // the transaction itself — treating it as a rejection made callers re-send
    // and burn fees on duplicate txs. Keep polling until maxAttempts.
  }

  if (maxAttempts && attempts >= maxAttempts) {
    return {
      success: false,
      failureReason: 'Max attempts reached',
    };
  }

  await new Promise((resolve) => setTimeout(resolve, interval));
  return waitForTransaction(
    transactionHash,
    endpoint,
    maxAttempts,
    interval,
    attempts + 1
  );
}
