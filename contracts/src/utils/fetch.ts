import { fetchLastBlock, Field, Mina, PublicKey, UInt32 } from 'o1js';
import { log } from './loggers.js';
import { PulsarAction } from '../types/PulsarAction.js';
import { ENDPOINTS } from './constants.js';
import { SettlementContract, SettlementEvent } from '../SettlementContract.js';

export {
  fetchActions,
  fetchRawActions,
  fetchBlockHeight,
  fetchEvents,
  setMinaNetwork,
  waitForTransaction,
};

async function fetchRawActions(
  address: PublicKey,
  fromActionState: Field,
  endActionState?: Field
) {
  try {
    const result = await Mina.fetchActions(address, {
      fromActionState,
      endActionState,
    });

    log('Fetched actions:', JSON.stringify(result), null, 2);

    if (Array.isArray(result)) {
      return result;
    } else {
      console.error('Error fetching actions:', result.error);
    }
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

async function fetchActions(
  address: PublicKey,
  fromActionState: Field,
  endActionState?: Field
) {
  const rawActions = await fetchRawActions(
    address,
    fromActionState,
    endActionState
  );

  if (!rawActions || rawActions.length === 0) {
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
    const result = await contractInstance.fetchEvents(from, to);
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
  const Network = Mina.Network({
    mina: ENDPOINTS.NODE[network],
    archive: ENDPOINTS.ARCHIVE[network],
  });

  console.log(
    `Setting Mina network to ${network}, Mina endpoint: ${ENDPOINTS.NODE[network]}, Archive endpoint: ${ENDPOINTS.ARCHIVE[network]}`
  );

  Mina.setActiveInstance(Network);
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
    return {
      success: false,
      failureReason: `Error checking transaction: ${error}`,
    };
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
