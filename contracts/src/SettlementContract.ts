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
  Provable,
  Poseidon,
} from 'o1js';
import { ActionType } from './utils/action';
import { SettlementProof } from './SettlementProof';
import { MINIMUM_DEPOSIT_AMOUNT } from './utils/constants';
import { ReduceVerifyProof } from './ReducerVerifierProof';
// import { Actions } from 'o1js/dist/node/lib/mina/v1/account-update';
const { BatchReducer } = Experimental;

export { BatchReducerInstance, Batch, BatchProof, SettlementContract };

let batchReducer = new BatchReducer({
  actionType: ActionType,
  batchSize: 10,
  maxUpdatesFinalProof: 100,
  maxUpdatesPerProof: 300,
});

const BatchReducerInstance = batchReducer;
class Batch extends batchReducer.Batch {}
class BatchProof extends batchReducer.BatchProof {}

class SettlementContract extends SmartContract {
  @state(Field) actionState = State(BatchReducer.initialActionState);
  @state(Field) actionStack = State(BatchReducer.initialActionStack);

  @state(Field) merkleListRoot = State<Field>();
  @state(Field) stateRoot = State<Field>();
  @state(Field) blockHeight = State<Field>();

  @state(Field) depositListHash = State<Field>();
  @state(Field) withdrawalListHash = State<Field>();
  @state(Field) rewardListHash = State<Field>();

  async deploy() {
    await super.deploy();

    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    });
  }

  @method
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
        InitialBlockHeight,
        NewBlockHeight,
        ProofGeneratorsList
      )
    );
    // let action = ActionType.settlement(
    //   InitialStateRoot,
    //   NewStateRoot,
    //   InitialMerkleListRoot,
    //   NewMerkleListRoot,
    //   InitialBlockHeight,
    //   NewBlockHeight,
    //   ProofGeneratorsList
    // );
    // let update = this.self;
    // let canonical = Provable.toCanonical(
    //   ActionType,
    //   ActionType.fromValue(action)
    // );
    // let fields = ActionType.toFields(canonical).slice(0, 16);
    // update.body.actions = Actions.pushEvent(update.body.actions, fields);
  }

  @method
  async deposit(amount: UInt64) {
    amount.assertGreaterThanOrEqual(
      UInt64.from(MINIMUM_DEPOSIT_AMOUNT),
      `At least ${Number(MINIMUM_DEPOSIT_AMOUNT / 1e9)} MINA is required`
    );
    const sender = this.sender.getUnconstrained();
    const depositAccountUpdate = AccountUpdate.createSigned(sender);
    depositAccountUpdate.send({ to: this.address, amount });

    batchReducer.dispatch(ActionType.deposit(sender, amount.value));
  }

  @method
  async withdraw() {}

  @method
  async reduce(
    batch: Batch,
    proof: BatchProof,
    reduceProof: ReduceVerifyProof
  ) {
    let stateRoot = this.stateRoot.getAndRequireEquals();
    let merkleListRoot = this.merkleListRoot.getAndRequireEquals();
    let blockHeight = this.blockHeight.getAndRequireEquals();

    let depositListHash = this.depositListHash.getAndRequireEquals();
    let withdrawalListHash = this.withdrawalListHash.getAndRequireEquals();
    let rewardListHash = this.rewardListHash.getAndRequireEquals();

    batchReducer.processBatch({ batch, proof }, (action, isDummy) => {
      const shouldSettle = ActionType.isSettlement(action)
        .and(action.initialState.equals(stateRoot))
        .and(action.initialMerkleListRoot.equals(merkleListRoot))
        .and(action.initialBlockHeight.equals(blockHeight))
        .and(isDummy.not());

      const shouldDeposit = ActionType.isDeposit(action).and(isDummy.not());

      const shouldWithdraw = ActionType.isWithdrawal(action).and(isDummy.not());

      stateRoot = Provable.if(shouldSettle, action.newState, stateRoot);

      merkleListRoot = Provable.if(
        shouldSettle,
        action.newMerkleListRoot,
        merkleListRoot
      );

      blockHeight = Provable.if(
        shouldSettle,
        action.newBlockHeight,
        blockHeight
      );

      depositListHash = Provable.if(
        shouldDeposit,
        Poseidon.hash([
          depositListHash,
          ...action.account.toFields(),
          action.amount,
        ]),
        depositListHash
      );

      withdrawalListHash = Provable.if(
        shouldWithdraw,
        Poseidon.hash([
          withdrawalListHash,
          ...action.account.toFields(),
          action.amount,
        ]),
        withdrawalListHash
      );

      rewardListHash = Provable.if(
        shouldSettle.or(shouldWithdraw),
        Poseidon.hash([rewardListHash, ...action.rewardListUpdate.toFields()]),
        rewardListHash
      );
    });

    reduceProof.verify();

    stateRoot.assertEquals(reduceProof.publicInput.stateRoot);
    merkleListRoot.assertEquals(reduceProof.publicInput.merkleListRoot);
    blockHeight.assertEquals(reduceProof.publicInput.blockHeight);
    depositListHash.assertEquals(reduceProof.publicInput.depositListHash);
    withdrawalListHash.assertEquals(reduceProof.publicInput.withdrawalListHash);
    rewardListHash.assertEquals(reduceProof.publicInput.rewardListHash);

    this.stateRoot.set(stateRoot);
    this.merkleListRoot.set(merkleListRoot);
    this.blockHeight.set(blockHeight);
    this.depositListHash.set(depositListHash);
    this.withdrawalListHash.set(withdrawalListHash);
    this.rewardListHash.set(rewardListHash);
  }
}
