import {
  SmartContract,
  Permissions,
  state,
  State,
  Field,
  method,
  Experimental,
} from 'o1js';
import { ActionType } from './Action';

const { BatchReducer } = Experimental;

export { BatchReducerInstance, Batch, BatchProof, SettlementContract };

let batchReducer = new BatchReducer({
  actionType: ActionType,
  batchSize: 64,
  maxUpdatesFinalProof: 4,
  maxUpdatesPerProof: 4,
});

const BatchReducerInstance = batchReducer;
class Batch extends batchReducer.Batch {}
class BatchProof extends batchReducer.BatchProof {}

class SettlementContract extends SmartContract {
  @state(Field) actionState = State(BatchReducer.initialActionState);
  @state(Field) actionStack = State(BatchReducer.initialActionStack);

  // The merkle list root is the root of the Minamos validator set.
  @state(Field) merkleListRoot = State<Field>();
  // The state root is the root of the Minamos state tree.
  @state(Field) stateRoot = State<Field>();
  // The block height is the height of the Minamos block.
  @state(Field) blockHeight = State<Field>();
  // The deposit tree root is the root of the deposit tree.
  @state(Field) depositTreeRoot = State<Field>();
  // The withdrawal tree root is the root of the withdrawal tree.
  @state(Field) withdrawalTreeRoot = State<Field>();
  // The rewards tree root is the root of the rewards tree.
  @state(Field) rewardsTreeRoot = State<Field>();

  async deploy() {
    await super.deploy();

    this.account.permissions.set({
      ...Permissions.default(),
    });
  }

  async initialize(merkleListRoot: Field) {
    super.init();
    this.merkleListRoot.set(merkleListRoot);
  }

  @method
  async settle() {}

  @method
  async deposit() {}

  @method
  async withdraw() {}
}
