import {
  SmartContract,
  Permissions,
  state,
  State,
  Field,
  method,
  Experimental,
  UInt64,
  AccountUpdate,
} from 'o1js';
import { ActionType } from './utils/action';
import { SettlementProof } from './SettlementProof';

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

  @state(Field) rewardListHash = State<Field>();

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
  async settle(settlementProof: SettlementProof) {
    settlementProof.verify();

    const {
      InitialMerkleListRoot,
      InitialStateRoot,
      InitialBlockHeight,
      NewBlockHeight,
      NewMerkleListRoot,
      NewStateRoot,
      ProofGeneratorsList,
    } = settlementProof.publicInput;

    InitialBlockHeight.assertEquals(
      this.blockHeight.getAndRequireEquals(),
      'Initial block height mismatch with on-chain state'
    );
    InitialMerkleListRoot.assertEquals(
      this.merkleListRoot.getAndRequireEquals(),
      'Initial MerkleList root mismatch with on-chain state'
    );
    InitialStateRoot.assertEquals(
      this.stateRoot.getAndRequireEquals(),
      'Initial Pulsar state root mismatch with on-chain state'
    );
    NewBlockHeight.assertGreaterThan(
      this.blockHeight.getAndRequireEquals(),
      'New block height must be greater than on-chain state'
    );

    batchReducer.dispatch(
      ActionType.settlement(
        InitialStateRoot,
        NewStateRoot,
        InitialMerkleListRoot,
        NewMerkleListRoot,
        ProofGeneratorsList
      )
    );
  }

  @method
  async deposit(amount: UInt64) {
    const sender = this.sender.getUnconstrained();
    const depositAccountUpdate = AccountUpdate.createSigned(sender);
    depositAccountUpdate.send({ to: this.address, amount });
  }

  @method
  async withdraw() {}
}
