import { fetchLastBlock, Field, Mina, PublicKey, UInt32 } from 'o1js';
import { log } from './loggers';
import { PulsarAction } from '../types/PulsarAction';
import { ENDPOINTS } from './constants';
import { SettlementContract, SettlementEvent } from '../SettlementContract';

export { fetchActions, fetchRawActions, fetchBlockHeight, fetchEvents };

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

async function fetchBlockHeight(network: 'devnet' | 'mainnet' = 'devnet') {
  try {
    const lastBlock = await fetchLastBlock(
      network === 'devnet' ? ENDPOINTS.NODE.devnet : ENDPOINTS.NODE.mainnet
    );

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
