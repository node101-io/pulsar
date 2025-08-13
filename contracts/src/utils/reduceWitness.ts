import { Bool, Field, Poseidon } from 'o1js';
import { ValidateReducePublicInput } from '../ValidateReduce.js';
import { log } from './loggers.js';
import {
  BATCH_SIZE,
  MAX_DEPOSIT_PER_BATCH,
  MAX_WITHDRAWAL_PER_BATCH,
} from './constants.js';
import { Batch, PulsarAction } from '../types/PulsarAction.js';
import { SettlementContract } from '../SettlementContract.js';
import { ReduceMask } from '../types/common.js';
import { GenerateActionStackProof } from './generateFunctions.js';
import { fetchActions } from './fetch.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers.js';

export {
  MapFromArray,
  CalculateMax,
  PrepareBatch,
  PrepareBatchWithActions,
  PackActions,
  validateActionQueue,
};

function MapFromArray(array: Field[]) {
  const map = new Map<string, number>();

  for (const field of array.map((x) => x.toString())) {
    const count = map.get(field) || 0;
    map.set(field, count + 1);

    log('map:', map);
    log('map.get(field):', map.get(field));
  }
  return map;
}

// maple
function CalculateMax(
  includedActionsMap: Map<string, number>,
  contractInstance: SettlementContract,
  packedActions: Array<{ action: PulsarAction; hash: bigint }>
) {
  let withdrawals = 0;
  let deposits = 0;

  const batchActions: Array<PulsarAction> = [];
  let endActionState = 0n;

  let mask = new Array<boolean>(BATCH_SIZE).fill(false);
  let publicInput = new ValidateReducePublicInput({
    stateRoot: contractInstance.stateRoot.get(),
    merkleListRoot: contractInstance.merkleListRoot.get(),
    blockHeight: contractInstance.blockHeight.get(),
    depositListHash: contractInstance.depositListHash.get(),
    withdrawalListHash: contractInstance.withdrawalListHash.get(),
  });

  for (const [i, pack] of packedActions.entries()) {
    if (batchActions.length === BATCH_SIZE) {
      log('Batch size reached:', batchActions.length);
      break;
    }

    const hash = pack.action.unconstrainedHash().toString();
    const count = includedActionsMap.get(hash) || 0;

    if (PulsarAction.isDeposit(pack.action).toBoolean()) {
      if (deposits === MAX_DEPOSIT_PER_BATCH) {
        log('Max deposits reached for batch');
        break;
      }
      deposits++;
      mask[i] = true;

      publicInput = new ValidateReducePublicInput({
        ...publicInput,
        depositListHash: Poseidon.hash([
          publicInput.depositListHash,
          ...pack.action.account.toFields(),
          pack.action.amount,
        ]),
      });
    } else if (PulsarAction.isWithdrawal(pack.action).toBoolean()) {
      if (count <= 0) {
        log('Action skipped:', pack.action.toJSON());
        batchActions.push(pack.action);
        endActionState = BigInt(pack.hash);
        continue;
      } else if (withdrawals === MAX_WITHDRAWAL_PER_BATCH) {
        log('Max withdrawals reached for batch');
        break;
      }
      withdrawals++;
      mask[i] = true;

      publicInput = new ValidateReducePublicInput({
        ...publicInput,
        withdrawalListHash: Poseidon.hash([
          publicInput.withdrawalListHash,
          ...pack.action.account.toFields(),
          pack.action.amount,
        ]),
      });
    }

    batchActions.push(pack.action);
    endActionState = BigInt(pack.hash);
  }

  return {
    endActionState,
    batchActions,
    publicInput,
    mask: ReduceMask.fromArray(mask),
  };
}

function PackActions(initialState: Field, actions: Array<PulsarAction>) {
  let packedActions: Array<{ action: PulsarAction; hash: bigint }> = [];

  for (const [i, action] of actions.entries()) {
    packedActions.push({
      action,
      hash:
        i === 0
          ? initialState.toBigInt()
          : merkleActionsAdd(
              Field(packedActions[i - 1].hash),
              actionListAdd(emptyActionListHash, action)
            ).toBigInt(),
    });
  }
  return packedActions;
}

// Included actions will be fetched from the validators
async function PrepareBatch(
  includedActions: Map<string, number>,
  contractInstance: SettlementContract
) {
  const packedActions = await fetchActions(
    contractInstance.address,
    contractInstance.actionState.get()
  );

  if (packedActions.length === 0) {
    log('No actions found for the contract.');
    return {
      endActionState: 0n,
      batchActions: [],
      batch: Batch.empty(),
      useActionStack: Bool(false),
      actionStackProof: undefined,
      publicInput: ValidateReducePublicInput.default,
      mask: ReduceMask.empty(),
    };
  }

  const { endActionState, batchActions, publicInput, mask } = CalculateMax(
    includedActions,
    contractInstance,
    packedActions
  );

  let actionStack = packedActions
    .slice(batchActions.length)
    .map((pack) => pack.action);

  log(
    'Batch actions:',
    batchActions.map((action) => action.toJSON()),
    '\n',
    'Action stack:',
    actionStack.map((action) => action.toJSON())
  );

  const batch = Batch.fromArray(batchActions);

  const { useActionStack, actionStackProof } = await GenerateActionStackProof(
    Field.from(endActionState),
    actionStack
  );

  log(
    'useActionStack:',
    useActionStack.toBoolean(),
    '\n',
    'actionStackProof Input:',
    actionStackProof.publicInput.toJSON(),
    'output:',
    actionStackProof.publicOutput.toJSON()
  );

  return {
    batchActions,
    batch,
    useActionStack,
    actionStackProof,
    publicInput,
    mask,
  };
}

async function PrepareBatchWithActions(
  includedActions: Map<string, number>,
  contractInstance: SettlementContract,
  packedActions: {
    action: PulsarAction;
    hash: bigint;
  }[]
) {
  if (packedActions.length === 0) {
    log('No actions found for the contract.');
    return {
      endActionState: 0n,
      batchActions: [],
      batch: Batch.empty(),
      useActionStack: Bool(false),
      actionStackProof: undefined,
      publicInput: ValidateReducePublicInput.default,
      mask: ReduceMask.empty(),
    };
  }

  const { endActionState, batchActions, publicInput, mask } = CalculateMax(
    includedActions,
    contractInstance,
    packedActions
  );

  let actionStack = packedActions
    .slice(batchActions.length)
    .map((pack) => pack.action);

  log(
    'Batch actions:',
    batchActions.map((action) => action.toJSON()),
    '\n',
    'Action stack:',
    actionStack.map((action) => action.toJSON())
  );

  const batch = Batch.fromArray(batchActions);

  const { useActionStack, actionStackProof } = await GenerateActionStackProof(
    Field.from(endActionState),
    actionStack
  );

  log(
    'useActionStack:',
    useActionStack.toBoolean(),
    '\n',
    'actionStackProof Input:',
    actionStackProof.publicInput.toJSON(),
    'output:',
    actionStackProof.publicOutput.toJSON()
  );

  return {
    batchActions,
    batch,
    useActionStack,
    actionStackProof,
    publicInput,
    mask,
  };
}

function validateActionQueue(
  rawActions: {
    actions: string[][];
    hash: string;
  }[],
  finalActionState: string
): {
  actions: Array<{ action: PulsarAction; hash: bigint }>;
  isValid: boolean;
} {
  if (rawActions.length === 0) {
    return {
      actions: [],
      isValid: false,
    };
  }

  const actions = rawActions.map((action) => {
    return {
      action: PulsarAction.fromRawAction(action.actions[0]),
      hash: BigInt(action.hash),
    };
  });

  actions.forEach((action, index) => {
    if (action.action.unconstrainedHash().toBigInt() !== action.hash) {
      log(
        `Action hash mismatch at index ${index}: expected ${
          action.hash
        }, got ${action.action.unconstrainedHash().toBigInt()}`
      );
      return { actions, isValid: false };
    }
  });

  let actionListHash = emptyActionListHash;
  for (const action of actions) {
    actionListHash = merkleActionsAdd(actionListHash, Field(action.hash));
  }

  if (actionListHash.toString() !== finalActionState) {
    log(
      `Action state mismatch: expected ${finalActionState}, got ${actionListHash.toString()}`
    );
    return { actions, isValid: false };
  }
  return {
    actions,
    isValid: true,
  };
}
