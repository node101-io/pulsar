import {
  SmartContract,
  Permissions,
  state,
  State,
  Field,
  method,
  UInt64,
  AccountUpdate,
  Provable,
  Poseidon,
  PublicKey,
  Reducer,
  Bool,
  Struct,
} from 'o1js';
import { SettlementProof } from './SettlementProof.js';
import {
  BATCH_SIZE,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
} from './utils/constants.js';
import { ValidateReduceProof } from './ValidateReduce.js';
import { Batch, PulsarAction } from './types/PulsarAction.js';
import { ReduceMask } from './types/common.js';
import { ActionStackProof } from './ActionStack.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from './types/actionHelpers.js';

export { SettlementContract, SettlementEvent };

class SettlementEvent extends Struct({
  fromActionState: Field,
  endActionState: Field,
  mask: Field,
}) {}

class SettlementContract extends SmartContract {
  @state(Field) actionState = State<Field>();

  @state(Field) merkleListRoot = State<Field>();
  @state(Field) stateRoot = State<Field>();
  @state(Field) blockHeight = State<Field>();

  @state(Field) depositListHash = State<Field>();
  @state(Field) withdrawalListHash = State<Field>();
  @state(Field) rewardListHash = State<Field>();

  reducer = Reducer({ actionType: PulsarAction });

  readonly events = {
    Settlement: SettlementEvent,
  };

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
    this.actionState.set(Reducer.initialActionState);
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

    // Maybe redundant
    NewBlockHeight.assertGreaterThan(
      this.blockHeight.getAndRequireEquals(),
      'New block height must be greater than on-chain state'
    );

    this.reducer.dispatch(
      PulsarAction.settlement(
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

    this.reducer.dispatch(PulsarAction.deposit(sender, amount.value));
  }

  @method
  async withdraw(amount: UInt64) {
    const account = this.sender.getUnconstrained();
    const withdrawalUpdate = AccountUpdate.createSigned(account);

    withdrawalUpdate.send({
      to: this.address,
      amount: amount.add(UInt64.from(WITHDRAW_DOWN_PAYMENT)),
    });

    this.reducer.dispatch(PulsarAction.withdrawal(account, amount.value));
  }

  @method
  async reduce(
    batch: Batch,
    useActionStack: Bool,
    actionStackProof: ActionStackProof,
    mask: ReduceMask,
    validateReduceProof: ValidateReduceProof
  ) {
    let stateRoot = this.stateRoot.getAndRequireEquals();
    let merkleListRoot = this.merkleListRoot.getAndRequireEquals();
    let blockHeight = this.blockHeight.getAndRequireEquals();

    let depositListHash = this.depositListHash.getAndRequireEquals();
    let withdrawalListHash = this.withdrawalListHash.getAndRequireEquals();
    let rewardListHash = this.rewardListHash.getAndRequireEquals();

    let initialActionState = this.actionState.getAndRequireEquals();
    let actionState = initialActionState;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const action = batch.actions[i];
      const isDummy = PulsarAction.isDummy(action);

      actionState = Provable.if(
        isDummy,
        actionState,
        merkleActionsAdd(
          actionState,
          actionListAdd(emptyActionListHash, action)
        )
      );

      const shouldSettle = PulsarAction.isSettlement(action)
        .and(action.initialState.equals(stateRoot))
        .and(action.initialMerkleListRoot.equals(merkleListRoot))
        .and(action.initialBlockHeight.equals(blockHeight))
        .and(isDummy.not())
        .and(mask.list[i]);

      const shouldDeposit = PulsarAction.isDeposit(action)
        .and(isDummy.not())
        .and(mask.list[i]);

      const shouldWithdraw = PulsarAction.isWithdrawal(action)
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
    }

    validateReduceProof.verify();

    stateRoot.assertEquals(validateReduceProof.publicInput.stateRoot);
    merkleListRoot.assertEquals(validateReduceProof.publicInput.merkleListRoot);
    blockHeight.assertEquals(validateReduceProof.publicInput.blockHeight);
    depositListHash.assertEquals(
      validateReduceProof.publicInput.depositListHash
    );
    withdrawalListHash.assertEquals(
      validateReduceProof.publicInput.withdrawalListHash
    );
    rewardListHash.assertEquals(validateReduceProof.publicInput.rewardListHash);

    actionStackProof.verifyIf(useActionStack);
    Provable.assertEqualIf(
      useActionStack,
      Field,
      actionStackProof.publicInput,
      actionState
    );

    this.account.actionState.requireEquals(
      Provable.if(useActionStack, actionStackProof.publicOutput, actionState)
    );

    this.emitEvent(
      'Settlement',
      new SettlementEvent({
        fromActionState: initialActionState,
        endActionState: actionState,
        mask: mask.toField(),
      })
    );

    this.actionState.set(actionState);
    this.stateRoot.set(stateRoot);
    this.merkleListRoot.set(merkleListRoot);
    this.blockHeight.set(blockHeight);
    this.depositListHash.set(depositListHash);
    this.withdrawalListHash.set(withdrawalListHash);
    this.rewardListHash.set(rewardListHash);
  }
}
