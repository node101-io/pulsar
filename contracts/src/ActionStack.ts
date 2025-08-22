import { Bool, Field, Provable, SelfProof, Struct, ZkProgram } from 'o1js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from './types/actionHelpers.js';
import { ACTION_QUEUE_SIZE } from './utils/constants.js';
import { PulsarAction } from './types/PulsarAction.js';

export { ActionStackProof, ActionStackQueue, ActionStackProgram };

class ActionList extends Struct({
  isDummy: Bool,
  actionListHash: Field,
}) {}

class ActionStackQueue extends Struct({
  stack: Provable.Array(ActionList, ACTION_QUEUE_SIZE),
}) {
  static empty() {
    return new this({
      stack: Array(ACTION_QUEUE_SIZE).fill(
        new ActionList({ isDummy: Bool(true), actionListHash: Field(0) })
      ),
    });
  }

  static fromArray(actions: PulsarAction[]) {
    if (actions.length > ACTION_QUEUE_SIZE) {
      throw new Error(`Too many actions, max is ${ACTION_QUEUE_SIZE}`);
    }
    const stack = ActionStackQueue.empty().stack;
    for (let i = 0; i < actions.length; i++) {
      stack[i] = new ActionList({
        isDummy: Bool(false),
        actionListHash: actionListAdd(emptyActionListHash, actions[i]),
      });
    }
    return new this({ stack });
  }
  toJSON() {
    return this.stack.map((item) => ({
      isDummy: item.isDummy.toBoolean(),
      actionListHash: item.actionListHash.toString(),
    }));
  }
}

const ActionStackProgram = ZkProgram({
  name: 'ActionStack',
  publicInput: Field,
  publicOutput: Field,
  methods: {
    proveBase: {
      privateInputs: [ActionStackQueue],
      async method(initialActionState: Field, actionQueue: ActionStackQueue) {
        let actionState = initialActionState;
        for (let i = 0; i < ACTION_QUEUE_SIZE; i++) {
          const action = actionQueue.stack[i];
          actionState = Provable.if(
            action.isDummy,
            actionState,
            merkleActionsAdd(actionState, action.actionListHash)
          );
        }

        return {
          publicOutput: actionState,
        };
      },
    },

    proveRecursive: {
      privateInputs: [SelfProof<Field, Field>, ActionStackQueue],
      async method(
        initialActionState: Field,
        proofSoFar: SelfProof<Field, Field>,
        actionQueue: ActionStackQueue
      ) {
        proofSoFar.verify();
        initialActionState.assertEquals(proofSoFar.publicOutput);

        let actionState = initialActionState;

        for (let i = 0; i < ACTION_QUEUE_SIZE; i++) {
          const action = actionQueue.stack[i];
          actionState = Provable.if(
            action.isDummy,
            actionState,
            merkleActionsAdd(actionState, action.actionListHash)
          );
        }

        return {
          publicOutput: actionState,
        };
      },
    },
  },
});

class ActionStackProof extends ZkProgram.Proof(ActionStackProgram) {}
