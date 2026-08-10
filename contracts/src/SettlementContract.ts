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
  PublicKey,
  Reducer,
  Bool,
  Struct,
  DeployArgs,
} from 'o1js';
import { SettlementProof } from './SettlementProof.js';
import {
  AGGREGATE_THRESHOLD,
  BATCH_SIZE,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
} from './utils/constants.js';
import { ApprovalQuorumProof } from './ApprovalQuorum.js';
import { Batch, PulsarAction, PulsarAuth } from './types/PulsarAction.js';
import { ApprovalVerdicts } from './types/common.js';
import { ActionStackProof } from './ActionStack.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from './types/actionHelpers.js';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from './utils/pulsarActionLeaf.js';

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

  /**
   * Was `actionListHash` — the prefix fold of the chain's v2 verdict-leaf
   * chain that this contract has consumed. Invariant with slot 0: actionState folds L1 actions
   * a_1..a_m and approvalCursor folds verdict leaves leaf_1..leaf_m for the
   * SAME m — one counter in two encodings, advanced only by reduce.
   */
  @state(Field) approvalCursor = State<Field>();

  reducer = Reducer({ actionType: PulsarAction });

  readonly events = {
    Settlement: SettlementEvent,
  };

  /**
   * Anchors the contract to the Pulsar block the first settlement proof
   * starts from — all three must come from one and the same block. Setting
   * them here rather than in a post-deploy `initialize` is deliberate:
   * initialize was a permissionless @method guarded only by o1js's
   * `provedState == false`, so whoever won the post-deploy race could
   * install a validator set of their own choosing and sign any body they
   * liked. deploy() is authorized by the zkApp key, which closes that hole.
   */
  async deploy(
    args: DeployArgs & {
      merkleListRoot: Field;
      stateRoot: Field;
      blockHeight: Field;
    }
  ) {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    });

    this.actionState.set(Reducer.initialActionState);
    this.merkleListRoot.set(args.merkleListRoot);
    this.stateRoot.set(args.stateRoot);
    this.blockHeight.set(args.blockHeight);
    // m = 0 of the cursor invariant: zero L1 actions consumed, zero chain
    // leaves consumed — Field(0) is the chain's empty actions root.
    this.approvalCursor.set(Field(0));
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

    this.blockHeight.requireEquals(InitialBlockHeight);
    this.merkleListRoot.requireEquals(InitialMerkleListRoot);
    this.stateRoot.requireEquals(InitialStateRoot);

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
    // The lower bound removes the archive-wrapper edge case (a withdraw(0)
    // must never reach the chain's scanner). The upper bound is required,
    // not cosmetic: reduce range-checks amount + WITHDRAW_DOWN_PAYMENT as a
    // UInt64, so an amount within WITHDRAW_DOWN_PAYMENT of 2^64 would make
    // the reduce circuit unsatisfiable at the queue head. 2^63 also keeps
    // the amount inside the chain's int64 domain.
    amount.assertGreaterThan(UInt64.zero, 'Withdrawal amount must be positive');
    amount.assertLessThan(
      UInt64.from(2n ** 63n),
      'Withdrawal amount must fit int64'
    );

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
    verdicts: ApprovalVerdicts,
    approvalProof: ApprovalQuorumProof
  ) {
    let approvalCursor = this.approvalCursor.getAndRequireEquals();

    let initialActionState = this.actionState.getAndRequireEquals();
    let actionState = initialActionState;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const action = batch.actions[i];
      const isDummy = PulsarAction.isDummy(action);

      // L1 cursor: Mina action-queue fold of every consumed action.
      actionState = Provable.if(
        isDummy,
        actionState,
        merkleActionsAdd(
          actionState,
          actionListAdd(emptyActionListHash, action)
        )
      );

      // Chain cursor: one v2 verdict leaf per consumed slot, folded in
      // lockstep — the same isDummy guard drives both cursors, so they
      // advance by the same count and cannot drift (the
      // alignment invariant). Dummy slots contribute to neither. The verdict is not
      // chosen here: with the actions pinned by the action-state anchors,
      // only the chain's own verdict vector folds to a cursor the quorum
      // proof below can bind to a signed root.
      const approved = verdicts.list[i];
      const leaf = hashPulsarActionLeafV2(action, approved);
      approvalCursor = Provable.if(
        isDummy,
        approvalCursor,
        foldApprovalCursor(approvalCursor, leaf)
      );

      // verdict = 1 on a withdrawal PAYS (amount + the returned down
      // payment); verdict = 0 folds unpaid — the down payment stays with
      // the contract. Deposits are credited chain-side, so their verdict
      // affects only the leaf.
      const shouldWithdraw = PulsarAction.isWithdrawal(action)
        .and(isDummy.not())
        .and(approved);

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

      this.send({ to, amount });
    }

    // Exactly two proofs are verified in this method (the Pickles limit):
    // the quorum proof internalizes the tail, extending cursorAfter leaf by
    // leaf to an actions_reduced_root that >= 2/3 of the validator set
    // signed in a real vote extension. The slot-1 pin is the second half of
    // the signer-set authentication — without it a prover could invent an
    // entire validator set that is merely self-consistent with its body.
    approvalProof.verify();

    this.merkleListRoot.requireEquals(
      approvalProof.publicInput.validatorSetRoot
    );
    approvalCursor.assertEquals(
      approvalProof.publicInput.cursorAfter,
      'Batch verdict fold must reach the quorum-bound approval cursor'
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
        mask: verdicts.toField(),
      })
    );

    this.actionState.set(actionState);
    this.approvalCursor.set(approvalCursor);
  }
}
