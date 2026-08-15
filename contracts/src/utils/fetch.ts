import { fetchLastBlock, Field, Mina, PublicKey, UInt32 } from 'o1js';
import { log } from './loggers.js';
import { PulsarAction } from '../types/PulsarAction.js';
import { ARCHIVE_FALLBACKS, ENDPOINTS } from './constants.js';
import { SettlementContract, SettlementEvent } from '../SettlementContract.js';

export {
  checkZkappTransaction,
  fetchActions,
  fetchRawActions,
  fetchBlockHeight,
  fetchEvents,
  setMinaNetwork,
  sliceActionHistory,
  waitForTransaction,
  withArchiveFailover,
};

// The network setMinaNetwork last configured, or null when it never ran —
// null means the active instance is caller-managed (LocalBlockchain in
// tests), where rebuilding it would clobber state and there is no fallback
// archive to reach anyway.
let configuredNetwork: 'devnet' | 'mainnet' | 'lightnet' | null = null;

function useArchiveEndpoint(archiveUrl: string) {
  Mina.setActiveInstance(
    Mina.Network({
      mina: ENDPOINTS.NODE[configuredNetwork!],
      archive: archiveUrl,
    })
  );
}

/**
 * Run an archive-backed fetch, walking ARCHIVE_FALLBACKS in order when it
 * fails. Sequential on purpose — o1js's own multi-endpoint support races
 * endpoints in pairs and a fast-failing primary wins the race (see the
 * ARCHIVE_FALLBACKS comment in constants.ts).
 *
 * The first attempt runs against whatever endpoint the active instance
 * already points at, so a fallback that worked stays sticky for later calls
 * (mid-outage the primary is not re-probed on every fetch). On total failure
 * the instance is reset to the primary and the LAST error propagates —
 * swallowing it into an empty result would make an archive outage
 * indistinguishable from a genuinely empty action queue.
 */
async function withArchiveFailover<T>(
  what: string,
  run: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  try {
    return await run();
  } catch (error) {
    lastError = error;
  }
  if (configuredNetwork !== null) {
    for (const archiveUrl of ARCHIVE_FALLBACKS[configuredNetwork]) {
      console.warn(
        `${what} failed (${
          lastError instanceof Error ? lastError.message : lastError
        }), retrying via fallback archive ${archiveUrl}`
      );
      useArchiveEndpoint(archiveUrl);
      try {
        return await run();
      } catch (error) {
        lastError = error;
      }
    }
    useArchiveEndpoint(ENDPOINTS.ARCHIVE[configuredNetwork]);
  }
  throw lastError;
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

  if (rawActions.length === 0) {
    // The archive can only slice the action history at block boundaries. A
    // fromActionState that landed mid-block — e.g. a BATCH_SIZE cut inside a
    // block that carried several dispatches — comes back empty even while
    // actions are pending. Refetch the full history and slice locally on the
    // per-action hash chain; callers verify the slice by refolding it against
    // the account's stored action states, so a bad slice can never prove.
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
    const lastBlock = await fetchLastBlock(ENDPOINTS.NODE[network]);

    return Number(lastBlock.blockchainLength.toBigint());
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
  useArchiveEndpoint(ENDPOINTS.ARCHIVE[network]);

  const fallbacks = ARCHIVE_FALLBACKS[network];
  console.log(
    `Setting Mina network to ${network}, Mina endpoint: ${ENDPOINTS.NODE[network]}, Archive endpoint: ${ENDPOINTS.ARCHIVE[network]}` +
      (fallbacks.length > 0
        ? ` (+${fallbacks.length} fallback(s): ${fallbacks.join(', ')})`
        : '')
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
