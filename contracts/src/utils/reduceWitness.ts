import { Bool, Field } from 'o1js';
import { BATCH_SIZE, MAX_WITHDRAWAL_PER_BATCH } from './constants.js';
import { Batch, PulsarAction } from '../types/PulsarAction.js';
import { ApprovalVerdicts } from '../types/common.js';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from './pulsarActionLeaf.js';

export { BuildVerdictBatch };

/**
 * Witness construction for reduce under the verdict-leaf model. The verdict is no
 * longer a local decision: the chain's leaf list mirrors the L1 action queue
 * position for position, so the walk is positional — no multiset, no
 * balance gate, no local approval policy. Per position the chain leaf can
 * only be leafV2(action, 0) or leafV2(action, 1); whichever matches IS the
 * chain's adjudication of exactly that action.
 *
 * NEITHER matching is a hard error, never a silent skip: it means the chain
 * scanned a different action at that queue position (phantom/dropped leaf,
 * fee-payer mismatch, reorg divergence). Building a batch across it could
 * never prove — the fold would reach no signed root — so refuse loudly and
 * leave the recovery to a chain-side rebase.
 *
 * @param packedActions the L1 action queue from the contract's actionState,
 *   in ledger order (the shape fetchActions returns)
 * @param chainLeaves the chain's v2 leaf list from the same position, i.e.
 *   the leaves whose fold extends the contract's approvalCursor
 * @param fromCursor the contract's current approvalCursor
 * @returns the batch (dummy-padded) with its per-slot chain verdicts, the
 *   consumed prefix `batchActions`, `endCursor` (the approval cursor after
 *   the batch — ApprovalQuorum's publicInput.cursorAfter and the tail
 *   anchor), and `tailLeaves` (the provided leaves the batch did not
 *   consume — the tail proof folds them from endCursor toward a signed
 *   actions_reduced_root)
 */
function BuildVerdictBatch(
  packedActions: Array<{ action: PulsarAction; hash: bigint }>,
  chainLeaves: Field[],
  fromCursor: Field
): {
  batch: Batch;
  verdicts: ApprovalVerdicts;
  batchActions: PulsarAction[];
  endCursor: Field;
  tailLeaves: Field[];
} {
  const batchActions: PulsarAction[] = [];
  const verdictBits: boolean[] = [];
  let endCursor = fromCursor;
  let approvedWithdrawals = 0;

  for (const [i, { action }] of packedActions.entries()) {
    if (batchActions.length === BATCH_SIZE) {
      break;
    }
    if (i >= chainLeaves.length) {
      // The chain's cursor: this action is not yet adjudicated. Folding past
      // it is the existing TransientReduceError path — stop, leave it queued.
      break;
    }

    const chainLeaf = chainLeaves[i].toBigInt();
    let approved: boolean;
    if (chainLeaf === hashPulsarActionLeafV2(action, Bool(true)).toBigInt()) {
      approved = true;
    } else if (
      chainLeaf === hashPulsarActionLeafV2(action, Bool(false)).toBigInt()
    ) {
      approved = false;
    } else {
      throw new Error(
        `chain leaf at position ${i} matches neither verdict for action ` +
          `${JSON.stringify(action.toJSON())} — chain/L1 divergence, ` +
          `refusing to build a batch across it`
      );
    }

    if (approved && PulsarAction.isWithdrawal(action).toBoolean()) {
      // An account-update budget, not a protocol rule: the tail absorbs the
      // remainder, so cutting before the (MAX+1)th paid withdrawal is legal
      // at any batch length.
      if (approvedWithdrawals === MAX_WITHDRAWAL_PER_BATCH) {
        break;
      }
      approvedWithdrawals++;
    }

    batchActions.push(action);
    verdictBits.push(approved);
    endCursor = foldApprovalCursor(endCursor, chainLeaves[i]);
  }

  return {
    batch: Batch.fromArray(batchActions),
    verdicts: ApprovalVerdicts.fromArray(
      verdictBits.concat(
        new Array(BATCH_SIZE - verdictBits.length).fill(false)
      )
    ),
    batchActions,
    endCursor,
    tailLeaves: chainLeaves.slice(batchActions.length),
  };
}
