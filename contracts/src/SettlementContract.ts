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
  AGGREGATE_THRESHOLD,
  BATCH_SIZE,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
} from './utils/constants.js';
import { ValidateReduceProof } from './ValidateReduce.js';
import { Batch, PulsarAction, PulsarAuth } from './types/PulsarAction.js';
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

    NewBlockHeight.assertEquals(
      InitialBlockHeight.add(Field.from(AGGREGATE_THRESHOLD)),
      'New block height must be equal to initial block height + AGGREGATE_THRESHOLD'
    );

    this.blockHeight.set(NewBlockHeight);
    this.merkleListRoot.set(NewMerkleListRoot);
    this.stateRoot.set(NewStateRoot);
  }

  @method
  async deposit(amount: UInt64, pulsarAuth: PulsarAuth) {
    amount.assertGreaterThanOrEqual(
      UInt64.from(MINIMUM_DEPOSIT_AMOUNT),
      `At least ${Number(MINIMUM_DEPOSIT_AMOUNT / 1e9)} MINA is required`
    );
    const sender = this.sender.getUnconstrained();
    const depositAccountUpdate = AccountUpdate.createSigned(sender);
    depositAccountUpdate.send({ to: this.address, amount });

    this.reducer.dispatch(
      PulsarAction.deposit(sender, amount.value, pulsarAuth)
    );
  }

  @method
  async withdraw(amount: UInt64) {
    const account = this.sender.getUnconstrained();
    const withdrawalUpdate = AccountUpdate.createSigned(account);

    withdrawalUpdate.send({
      to: this.address,
      amount: UInt64.from(WITHDRAW_DOWN_PAYMENT),
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
    let merkleListRoot = this.merkleListRoot.getAndRequireEquals();
    let depositListHash = this.depositListHash.getAndRequireEquals();
    let withdrawalListHash = this.withdrawalListHash.getAndRequireEquals();

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

      const shouldDeposit = PulsarAction.isDeposit(action)
        .and(isDummy.not())
        .and(mask.list[i]);

      const shouldWithdraw = PulsarAction.isWithdrawal(action)
        .and(isDummy.not())
        .and(mask.list[i]);

      depositListHash = Provable.if(
        shouldDeposit,
        Poseidon.hash([
          depositListHash,
          ...action.account.toFields(),
          action.amount,
          ...action.pulsarAuth.toFields(),
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

      const to = Provable.if(
        shouldWithdraw,
        action.account,
        PublicKey.from({
          x: Field(0),
          isOdd: Bool(false),
        })
      );

      const amount = Provable.if(
        shouldWithdraw,
        UInt64.Unsafe.fromField(action.amount).add(WITHDRAW_DOWN_PAYMENT),
        UInt64.from(0)
      );

      Provable.asProver(() => {
        if (!isDummy.toBoolean()) {
          console.log('Processing action:', action.toJSON());
        }
        if (shouldWithdraw.toBoolean()) {
          console.log(`Withdrawing ${amount.toString()} to ${to.toBase58()}`);
        } else if (shouldDeposit.toBoolean()) {
          console.log(
            `Depositing ${UInt64.Unsafe.fromField(
              action.amount
            ).toString()} from ${action.account.toBase58()}`
          );
        }
      });

      this.send({
        to,
        amount,
      });
    }

    validateReduceProof.verify();

    merkleListRoot.assertEquals(validateReduceProof.publicInput.merkleListRoot);
    depositListHash.assertEquals(
      validateReduceProof.publicInput.depositListHash
    );
    withdrawalListHash.assertEquals(
      validateReduceProof.publicInput.withdrawalListHash
    );

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
    this.depositListHash.set(depositListHash);
    this.withdrawalListHash.set(withdrawalListHash);
  }
}
