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
  PublicKey,
} from 'o1js';
import { SettlementProof } from './SettlementProof';
import {
  BATCH_SIZE,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
} from './utils/constants';
import { ReduceVerifierProof } from './ReducerVerifierProof';
import { ActionType } from './types/action';
import { ReduceMask } from './types/common';

const { BatchReducer } = Experimental;

export { BatchReducerInstance, Batch, BatchProof, SettlementContract };

let batchReducer = new BatchReducer({
  actionType: ActionType,
  batchSize: BATCH_SIZE,
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
  async withdraw(amount: UInt64) {
    const account = this.sender.getUnconstrained();
    const withdrawalUpdate = AccountUpdate.createSigned(account);

    withdrawalUpdate.send({
      to: this.address,
      amount: amount.add(UInt64.from(WITHDRAW_DOWN_PAYMENT)),
    });

    batchReducer.dispatch(ActionType.withdrawal(account, amount.value));
  }

  @method
  async reduce(
    batch: Batch,
    proof: BatchProof,
    mask: ReduceMask,
    reduceProof: ReduceVerifierProof
  ) {
    let stateRoot = this.stateRoot.getAndRequireEquals();
    let merkleListRoot = this.merkleListRoot.getAndRequireEquals();
    let blockHeight = this.blockHeight.getAndRequireEquals();

    let depositListHash = this.depositListHash.getAndRequireEquals();
    let withdrawalListHash = this.withdrawalListHash.getAndRequireEquals();
    let rewardListHash = this.rewardListHash.getAndRequireEquals();

    batchReducer.processBatch({ batch, proof }, (action, isDummy, i) => {
      const shouldSettle = ActionType.isSettlement(action)
        .and(action.initialState.equals(stateRoot))
        .and(action.initialMerkleListRoot.equals(merkleListRoot))
        .and(action.initialBlockHeight.equals(blockHeight))
        .and(isDummy.not())
        .and(mask.list[i]);

      const shouldDeposit = ActionType.isDeposit(action)
        .and(isDummy.not())
        .and(mask.list[i]);

      const shouldWithdraw = ActionType.isWithdrawal(action)
        .and(isDummy.not())
        .and(mask.list[i]);

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

      this.send({
        to: Provable.if(shouldWithdraw, action.account, PublicKey.empty()),
        amount: Provable.if(
          shouldWithdraw,
          UInt64.Unsafe.fromField(action.amount).add(WITHDRAW_DOWN_PAYMENT),
          UInt64.from(0)
        ),
      });

      rewardListHash = Provable.if(
        shouldSettle,
        Poseidon.hash([rewardListHash, action.rewardListUpdateHash]),
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
