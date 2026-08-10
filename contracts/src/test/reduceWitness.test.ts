import { Bool, Field, PrivateKey, PublicKey } from 'o1js';
import { BuildVerdictBatch } from '../utils/reduceWitness.js';
import { PulsarAction, PulsarAuth } from '../types/PulsarAction.js';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from '../utils/pulsarActionLeaf.js';
import {
  BATCH_SIZE,
  MAX_WITHDRAWAL_PER_BATCH,
} from '../utils/constants.js';

// The chain's leaf list mirrors the L1 queue position for position, so the
// verdict walk is positional: per slot, exactly one of leafV2(action, 0) /
// leafV2(action, 1) can equal the chain leaf, and that bit IS the chain's
// adjudication. A mismatch means the chain scanned a different action at that
// position — a batch across it could never fold to a signed root, so it must
// throw, never silently skip.
describe('BuildVerdictBatch', () => {
  const account = PrivateKey.fromBigInt(1n).toPublicKey();
  const otherAccount = PrivateKey.fromBigInt(2n).toPublicKey();

  const withdrawal = (of: PublicKey = account) =>
    PulsarAction.withdrawal(of, Field(5_000_000_000n));
  const deposit = (of: PublicKey = account) =>
    PulsarAction.deposit(of, Field(3_000_000_000n), PulsarAuth.empty());

  // hash values only matter to the action-stack anchor, which is not this
  // function's output — any distinct chain of bigints works here.
  const pack = (actions: PulsarAction[]) =>
    actions.map((action, i) => ({ action, hash: BigInt(1000 + i) }));

  const leaf = (action: PulsarAction, approved: boolean) =>
    hashPulsarActionLeafV2(action, Bool(approved));

  // Never Field(0): the reduce always folds from the contract's committed
  // cursor, and the fixture convention pins non-zero starting roots.
  const fromCursor = Field(4242);

  const foldAll = (leaves: Field[], from: Field = fromCursor) =>
    leaves.reduce((cursor, l) => foldApprovalCursor(cursor, l), from);

  it('splits verdicts positionally on a mixed batch', () => {
    const actions = [deposit(), withdrawal(), deposit(otherAccount)];
    const leaves = [
      leaf(actions[0], true),
      leaf(actions[1], false),
      leaf(actions[2], true),
    ];

    const { batch, verdicts, batchActions, endCursor, tailLeaves } =
      BuildVerdictBatch(pack(actions), leaves, fromCursor);

    expect(verdicts.toJSON().slice(0, 3)).toEqual([true, false, true]);
    expect(batchActions.length).toBe(3);
    expect(tailLeaves).toEqual([]);
    expect(endCursor.toBigInt()).toBe(foldAll(leaves).toBigInt());
    // The batch is dummy-padded to BATCH_SIZE, real actions first.
    expect(batch.actions[1].amount.toBigInt()).toBe(
      actions[1].amount.toBigInt()
    );
    expect(PulsarAction.isDummy(batch.actions[3]).toBoolean()).toBe(true);
  });

  it('throws on a positional mismatch instead of skipping', () => {
    // Chain leaf at position 1 belongs to a DIFFERENT action — neither
    // verdict of the L1 action at that position can reproduce it.
    const actions = [deposit(), withdrawal()];
    const leaves = [leaf(actions[0], true), leaf(withdrawal(otherAccount), true)];

    expect(() => BuildVerdictBatch(pack(actions), leaves, fromCursor)).toThrow(
      /position 1 matches neither verdict/
    );
  });

  it('takes verdicts positionally for a duplicate-content pair', () => {
    // Two identical withdrawals fold to the same pair of candidate leaves;
    // the chain approved only the first. Under the old multiset this was the
    // one-approval-pays-every-duplicate hazard — positionally it is trivial.
    const actions = [withdrawal(), withdrawal()];
    const leaves = [leaf(actions[0], true), leaf(actions[1], false)];

    const { verdicts, batchActions } = BuildVerdictBatch(
      pack(actions),
      leaves,
      fromCursor
    );

    expect(verdicts.toJSON().slice(0, 2)).toEqual([true, false]);
    expect(batchActions.length).toBe(2);
  });

  it('cuts at the chain cursor and leaves unadjudicated actions unconsumed', () => {
    // The chain has scanned only 2 of 4 queued actions: the batch must stop
    // at its cursor — consuming further could never reach a signed root.
    const actions = [deposit(), withdrawal(), deposit(), withdrawal()];
    const leaves = [leaf(actions[0], true), leaf(actions[1], true)];

    const { verdicts, batchActions, endCursor, tailLeaves } = BuildVerdictBatch(
      pack(actions),
      leaves,
      fromCursor
    );

    expect(batchActions.length).toBe(2);
    expect(verdicts.toJSON().slice(0, 2)).toEqual([true, true]);
    expect(tailLeaves).toEqual([]);
    expect(endCursor.toBigInt()).toBe(foldAll(leaves).toBigInt());
  });

  it('cuts before the approved withdrawal exceeding MAX_WITHDRAWAL_PER_BATCH', () => {
    // MAX+1 approved withdrawals with a rejected one in between: the batch
    // carries MAX paid slots plus the rejected one, and the excess approval
    // stays in the tail slice for the quorum proof to absorb.
    const actions: PulsarAction[] = [];
    const approvedBits: boolean[] = [];
    for (let i = 0; i < MAX_WITHDRAWAL_PER_BATCH; i++) {
      actions.push(withdrawal());
      approvedBits.push(true);
    }
    actions.push(withdrawal(otherAccount));
    approvedBits.push(false);
    actions.push(withdrawal());
    approvedBits.push(true);
    const leaves = actions.map((action, i) => leaf(action, approvedBits[i]));

    const { verdicts, batchActions, endCursor, tailLeaves } = BuildVerdictBatch(
      pack(actions),
      leaves,
      fromCursor
    );

    // Everything up to and including the rejected slot is consumed; the
    // (MAX+1)th APPROVED withdrawal is not.
    expect(batchActions.length).toBe(MAX_WITHDRAWAL_PER_BATCH + 1);
    expect(verdicts.toJSON().slice(0, MAX_WITHDRAWAL_PER_BATCH + 1)).toEqual(
      approvedBits.slice(0, MAX_WITHDRAWAL_PER_BATCH + 1)
    );
    expect(tailLeaves).toEqual(leaves.slice(MAX_WITHDRAWAL_PER_BATCH + 1));
    expect(endCursor.toBigInt()).toBe(
      foldAll(leaves.slice(0, MAX_WITHDRAWAL_PER_BATCH + 1)).toBigInt()
    );
  });

  it('cuts at BATCH_SIZE and returns the remaining leaves as the tail', () => {
    // Approved deposits only — no withdrawal cap in play, so the cut is the
    // batch capacity itself.
    const actions = Array.from({ length: BATCH_SIZE + 2 }, () => deposit());
    const leaves = actions.map((action) => leaf(action, true));

    const { batchActions, endCursor, tailLeaves } = BuildVerdictBatch(
      pack(actions),
      leaves,
      fromCursor
    );

    expect(batchActions.length).toBe(BATCH_SIZE);
    expect(tailLeaves).toEqual(leaves.slice(BATCH_SIZE));
    expect(endCursor.toBigInt()).toBe(
      foldAll(leaves.slice(0, BATCH_SIZE)).toBigInt()
    );
  });

  it('returns an empty batch at an unmoved chain cursor', () => {
    const { batchActions, verdicts, endCursor, tailLeaves } = BuildVerdictBatch(
      pack([deposit(), withdrawal()]),
      [],
      fromCursor
    );

    expect(batchActions).toEqual([]);
    expect(verdicts.toJSON().every((bit) => bit === false)).toBe(true);
    expect(endCursor.toBigInt()).toBe(fromCursor.toBigInt());
    expect(tailLeaves).toEqual([]);
  });
});
