import { Field, Mina, PublicKey } from 'o1js';
import { log } from './loggers';
import { PulsarAction } from '../types/PulsarAction';

export { fetchActions, fetchRawActions };

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
