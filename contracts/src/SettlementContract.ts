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
import { SettlementPublicInputs } from './SettlementProof.js';
import {
  SettleAttestProof,
  settleAttestCommitment,
} from './SettleAttest.js';
import {
  AGGREGATE_THRESHOLD,
  BATCH_SIZE,
  INT64_AMOUNT_UPPER_BOUND,
  MINIMUM_DEPOSIT_AMOUNT,
  WITHDRAW_DOWN_PAYMENT,
} from './utils/constants.js';
import {
  ApprovalQuorumProof,
  reduceCommitmentHash,
} from './ApprovalQuorum.js';
import { Batch, PulsarAction, PulsarAuth } from './types/PulsarAction.js';
import { ApprovalVerdicts } from './types/common.js';
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

  /**
   * Settles through the SettleAttest ADAPTER, not the settlement proof
   * directly: a branch verifying MultisigVerifier's SettlementProof makes
   * the reduce branch's wrap unsatisfiable on o1js 2.10–2.15 once reduce
   * verifies the batch-folding quorum program (2026-08-11 hunt — remove
   * either side and the other proves). The attest proof's single public
   * field commits to all six settlement values, and the commitment
   * recomputed here from the ARGUMENT pins them — security is unchanged,
   * the indirection is purely a wrap-bug workaround (see SettleAttest.ts).
   */
  @method
  async settle(
    settlementPublicInput: SettlementPublicInputs,
    attestProof: SettleAttestProof
  ) {
    attestProof.verify();
    settleAttestCommitment(settlementPublicInput).assertEquals(
      attestProof.publicInput,
      'Attest proof must commit to these settlement values'
    );

    const {
      InitialMerkleListRoot,
      InitialStateRoot,
      InitialBlockHeight,
      NewBlockHeight,
      NewMerkleListRoot,
      NewStateRoot,
    } = settlementPublicInput;

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
    amount.assertLessThan(
      UInt64.from(INT64_AMOUNT_UPPER_BOUND),
      'Deposit amount must fit int64'
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
      UInt64.from(INT64_AMOUNT_UPPER_BOUND),
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
    cursorAfter: Field,
    approvalProof: ApprovalQuorumProof
  ) {
    const approvalCursor = this.approvalCursor.getAndRequireEquals();

    let initialActionState = this.actionState.getAndRequireEquals();
    let actionState = initialActionState;

    // The chain-convention verdict-leaf fold does NOT run here: computing
    // those hashes inside a SmartContract method makes this contract's
    // Pickles wrap unsatisfiable on o1js 2.10–2.15 (bisected empirically in
    // the 2026-08-11 live smoke — the shapes left in this method are the
    // ones proven to wrap). The fold lives in ApprovalQuorumProgram, and
    // this method binds itself to it through the endpoint assertions below:
    // the action-state fold here and the one inside the program run over
    // batches with equal start AND end states, so by collision resistance
    // they run over the SAME actions — and verdictsPacked pins the verdict
    // vector those leaves commit to.
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

      // verdict = 1 on a withdrawal PAYS (amount + the returned down
      // payment); verdict = 0 folds unpaid — the down payment stays with
      // the contract. Deposits are credited chain-side, so their verdict
      // affects only the leaf.
      const shouldWithdraw = PulsarAction.isWithdrawal(action)
        .and(isDummy.not())
        .and(verdicts.list[i]);

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
    // the quorum proof internalizes the batch's verdict-leaf fold AND the
    // tail, extending cursorBefore leaf by leaf to an actions_reduced_root
    // that >= 2/3 of the validator set signed in a real vote extension. The
    // slot-1 pin is the second half of the signer-set authentication —
    // without it a prover could invent an entire validator set that is
    // merely self-consistent with its body.
    approvalProof.verify();

    this.merkleListRoot.requireEquals(
      approvalProof.publicInput.validatorSetRoot
    );
    // The endpoint pin that replaces the in-contract verdict fold: the
    // commitment recomputed here from the contract's OWN values must equal
    // the one the program proved its fold against. By collision resistance,
    // hash equality is equality of all five values at once — same
    // action-state start AND end ⇒ the program folded the SAME actions;
    // same packed verdicts ⇒ under the vector the sends above pay from;
    // same cursorBefore ⇒ anchored at slot 4; same cursorAfter ⇒ the
    // argument written to slot 4 below is the fold's real result. One plain
    // zero-init Poseidon — the in-contract hash shape the wrap provably
    // handles (the chain-convention prefix hashes do NOT prove in here,
    // which is why the fold lives in the program at all).
    reduceCommitmentHash({
      fromActionState: initialActionState,
      endActionState: actionState,
      cursorBefore: approvalCursor,
      cursorAfter,
      verdictsPacked: verdicts.toField(),
    }).assertEquals(
      approvalProof.publicInput.reduceCommitment,
      'Quorum proof must commit to this exact batch, verdicts and cursors'
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
    this.approvalCursor.set(cursorAfter);
  }
}
