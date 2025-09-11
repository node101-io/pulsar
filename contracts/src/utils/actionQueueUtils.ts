import { Field, Poseidon } from 'o1js';
import { PulsarAction, PulsarAuth } from '../types/PulsarAction.js';
import { PulsarActionData } from '../types/common.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers.js';
import { PulsarEncoder } from './cosmosUtils.js';

export { validateActionList, CalculateFinalActionState, PulsarActionData };

interface ProcessedAction {
  action: PulsarAction;
  hash: bigint;
}

function CalculateFinalActionState(
  initialActionState: Field,
  actions: PulsarAction[]
): Field {
  let currentState = initialActionState;
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    currentState = merkleActionsAdd(
      currentState,
      actionListAdd(emptyActionListHash, action)
    );
  }
  return currentState;
}

function validateActionList(
  initialState: Field,
  rawActions: PulsarActionData[]
): {
  actions: ProcessedAction[];
  finalActionState: string;
} {
  if (rawActions.length === 0) {
    return { actions: [], finalActionState: emptyActionListHash.toString() };
  }

  const actions: ProcessedAction[] = rawActions.map(
    (action: PulsarActionData) => {
      let actionType: number;
      if (action.action_type === 'deposit') {
        actionType = 1;
      } else {
        actionType = 2;
      }

      const pulsarAction = new PulsarAction({
        type: Field(actionType),
        account: PulsarEncoder.fromAddress(action.public_key),
        amount: Field(action.amount),
        pulsarAuth: PulsarAuth.from(
          Field(BigInt(action.cosmos_address)),
          PulsarEncoder.parseCosmosSignature(action.cosmos_signature)
        ),
      });

      return {
        action: pulsarAction,
        hash: Poseidon.hash(pulsarAction.toFields()).toBigInt(),
      };
    }
  );

  let actionState = CalculateFinalActionState(
    initialState,
    actions.map((a) => a.action)
  );

  return { actions, finalActionState: actionState.toString() };
}
