import { Bool, Field, Poseidon } from 'o1js';
import { ValidateReducePublicInput } from '../ValidateReduce';
import { log } from './loggers.js';
import {
  BATCH_SIZE,
  MAX_DEPOSIT_PER_BATCH,
  MAX_SETTLEMENT_PER_BATCH,
  MAX_WITHDRAWAL_PER_BATCH,
} from './constants';
import { Batch, PulsarAction } from '../types/PulsarAction';
import { SettlementContract } from '../SettlementContract';
import { ReduceMask } from '../types/common';
import { GenerateActionStackProof } from './generateFunctions';
import { fetchActions } from './fetch';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers';

export { CalculateMask, PrepareBatch, CalculateMaksimumFromActions };

// Todo: Maybe always include deposit actions?
async function CalculateMask(
  contractInstance: SettlementContract,
  includedActions: Map<string, number>,
  batchActions: Array<PulsarAction>
) {
  let mask = new Array<boolean>(BATCH_SIZE).fill(false);
  let publicInput = new ValidateReducePublicInput({
    stateRoot: contractInstance.stateRoot.get(),
    merkleListRoot: contractInstance.merkleListRoot.get(),
    blockHeight: contractInstance.blockHeight.get(),
    depositListHash: contractInstance.depositListHash.get(),
    withdrawalListHash: contractInstance.withdrawalListHash.get(),
    rewardListHash: contractInstance.rewardListHash.get(),
  });

  for (let i = 0; i < batchActions.length; i++) {
    const action = batchActions[i];
    const hash = action.unconstrainedHash().toString();
    const count = includedActions.get(hash);

    if (
      Number(action.type.toString()) !== 0 &&
      count !== undefined &&
      count > 0
    ) {
      const count = includedActions.get(hash)!;

      mask[i] = true;
      includedActions.set(hash, count - 1);

      if (PulsarAction.isSettlement(action).toBoolean()) {
        log('Settlement');
        publicInput = new ValidateReducePublicInput({
          ...publicInput,
          stateRoot: action.newState,
          merkleListRoot: action.newMerkleListRoot,
          blockHeight: action.newBlockHeight,
          rewardListHash: Poseidon.hash([
            publicInput.rewardListHash,
            action.rewardListUpdateHash,
          ]),
        });
      } else if (PulsarAction.isDeposit(action).toBoolean()) {
        log('Deposit');
        publicInput = new ValidateReducePublicInput({
          ...publicInput,
          depositListHash: Poseidon.hash([
            publicInput.depositListHash,
            ...action.account.toFields(),
            action.amount,
          ]),
        });
      } else if (PulsarAction.isWithdrawal(action).toBoolean()) {
        log('Withdrawal');
        publicInput = new ValidateReducePublicInput({
          ...publicInput,
          withdrawalListHash: Poseidon.hash([
            publicInput.withdrawalListHash,
            ...action.account.toFields(),
            action.amount,
          ]),
        });
      }
      log('updated publicInput:', publicInput.toJSON());
    }
  }

  return {
    publicInput,
    mask: ReduceMask.fromArray(mask),
  };
}

function CalculateMaksimumFromPackedActions(
  packedActions: Array<{ action: PulsarAction; hash: bigint }>
) {
  let totalWithdrawals = 0;
  let totalDeposits = 0;
  let totalSettlements = 0;
  const batchActions: Array<PulsarAction> = [];
  let endActionState = 0n;

  for (const pack of packedActions) {
    if (PulsarAction.isSettlement(pack.action).toBoolean()) {
      if (totalSettlements === MAX_SETTLEMENT_PER_BATCH) {
        log('Max settlements reached for batch');
        break;
      }
      totalSettlements++;
    } else if (PulsarAction.isDeposit(pack.action).toBoolean()) {
      if (totalDeposits === MAX_DEPOSIT_PER_BATCH) {
        log('Max deposits reached for batch');
        break;
      }
      totalDeposits++;
    } else if (PulsarAction.isWithdrawal(pack.action).toBoolean()) {
      if (totalWithdrawals === MAX_WITHDRAWAL_PER_BATCH) {
        log('Max withdrawals reached for batch');
        break;
      }
      totalWithdrawals++;
    }

    batchActions.push(pack.action);
    endActionState = BigInt(pack.hash);

    if (batchActions.length === BATCH_SIZE) {
      log('Batch size reached:', batchActions.length);
      break;
    }
  }

  return {
    endActionState,
    batchActions,
  };
}

function CalculateMaksimumFromActions(
  initialState: Field,
  actions: Array<PulsarAction>
) {
  let totalWithdrawals = 0;
  let totalDeposits = 0;
  let totalSettlements = 0;
  const batchActions: Array<PulsarAction> = [];
  let endActionState = initialState;

  for (const action of actions) {
    if (PulsarAction.isSettlement(action).toBoolean()) {
      if (totalSettlements === MAX_SETTLEMENT_PER_BATCH) {
        log('Max settlements reached for batch');
        break;
      }
      totalSettlements++;
    } else if (PulsarAction.isDeposit(action).toBoolean()) {
      if (totalDeposits === MAX_DEPOSIT_PER_BATCH) {
        log('Max deposits reached for batch');
        break;
      }
      totalDeposits++;
    } else if (PulsarAction.isWithdrawal(action).toBoolean()) {
      if (totalWithdrawals === MAX_WITHDRAWAL_PER_BATCH) {
        log('Max withdrawals reached for batch');
        break;
      }
      totalWithdrawals++;
    }

    batchActions.push(action);
    endActionState = merkleActionsAdd(
      endActionState,
      actionListAdd(emptyActionListHash, action)
    );

    if (batchActions.length === BATCH_SIZE) {
      log('Batch size reached:', batchActions.length);
      break;
    }
  }

  return {
    endActionState,
    batchActions,
  };
}

async function PrepareBatch(contractInstance: SettlementContract) {
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
    };
  }

  const { endActionState, batchActions } =
    CalculateMaksimumFromPackedActions(packedActions);

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
  };
}
