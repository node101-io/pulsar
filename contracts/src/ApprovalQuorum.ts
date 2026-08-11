import { Field, Poseidon, Provable, Struct, ZkProgram } from 'o1js';
import { BATCH_SIZE, VALIDATOR_NUMBER } from './utils/constants.js';
import { SignaturePublicKeyList } from './types/signaturePubKeyList.js';
import { ApprovalVerdicts, List } from './types/common.js';
import { hashValidatorLeaf } from './utils/validatorList.js';
import { VoteExtBody } from './types/voteExtBody.js';
import { ApprovalTailProof } from './ApprovalTail.js';
import { Batch, PulsarAction } from './types/PulsarAction.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from './types/actionHelpers.js';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from './utils/pulsarActionLeaf.js';

export {
  ApprovalQuorumProof,
  ApprovalQuorumPublicInput,
  ApprovalQuorumProgram,
  reduceCommitmentHash,
};

/**
 * The full contract-facing surface of the quorum proof. Everything the
 * reduce method needs to know about the batch's chain-side adjudication is
 * public here, because reduce no longer folds a single verdict leaf itself:
 * computing the chain's leaf/cursor hashes inside a SmartContract method
 * makes the contract's Pickles wrap unsatisfiable on o1js 2.10–2.15
 * (empirically bisected in the 2026-08-11 live smoke; ZkPrograms are
 * unaffected), so the whole verdict fold lives in THIS program and the
 * contract only pins endpoints:
 *
 * - fromActionState/endActionState: the L1 action-state fold over the SAME
 *   private batch this program hashes into verdict leaves. The contract
 *   recomputes this fold from its own batch argument (that shape proves
 *   fine in-contract) and asserts both ends, which binds the program's
 *   private actions to the actions being reduced — collision resistance of
 *   the action-state fold leaves the prover no freedom.
 * - cursorBefore/cursorAfter: the chain-convention verdict-leaf fold over
 *   those actions, anchored at the contract's approvalCursor slot and
 *   extended by the tail proof to the quorum-signed actions_reduced_root.
 * - verdictsPacked: Field.fromBits of the verdict vector. The contract pays
 *   withdrawals from ITS verdicts argument, so it must be the exact vector
 *   the leaves commit to — bit-packing is sponge-free, so both sides can
 *   afford the equality.
 * - validatorSetRoot: pinned by reduce against contract slot 1; the signed
 *   body must carry it.
 */
class ApprovalQuorumPublicInput extends Struct({
  validatorSetRoot: Field,
  /**
   * Poseidon.hash([fromActionState, endActionState, cursorBefore,
   * cursorAfter, verdictsPacked]) — the five endpoint values compressed into
   * one field. Every proof historically verified inside this contract
   * carried a <= 2-field public input, and the wrap-bug hunt showed the
   * in-contract shapes must stay on proven ground, so the surface stays two
   * fields and the contract recomputes this hash (a single plain
   * zero-init Poseidon — a proven in-contract shape) from its own values.
   */
  reduceCommitment: Field,
}) {}

/** The one commitment formula, shared by the program and the contract. */
function reduceCommitmentHash(values: {
  fromActionState: Field;
  endActionState: Field;
  cursorBefore: Field;
  cursorAfter: Field;
  verdictsPacked: Field;
}): Field {
  return Poseidon.hash([
    values.fromActionState,
    values.endActionState,
    values.cursorBefore,
    values.cursorAfter,
    values.verdictsPacked,
  ]);
}

/**
 * Proves that >= 2/3 of a validator set's voting power signed one vote-
 * extension body — the message Pulsar validators ALREADY sign every block in
 * ExtendVote — AND that the batch's verdict-leaf fold connects the
 * contract's approval cursor to that body's signed actionsReducedRoot.
 *
 * The batch fold lives here (not in reduce) for the wrap-bug reason above;
 * the tail proof is consumed here (not by the contract) because reduce must
 * keep verifying exactly two proofs (this one and the action stack — the
 * Pickles limit). Without the in-program cursor linkage a prover could pair
 * any quorum-signed body with a batch whose cursor never reaches that
 * body's root.
 */
const ApprovalQuorumProgram = ZkProgram({
  name: 'ApprovalQuorum',
  publicInput: ApprovalQuorumPublicInput,
  publicOutput: undefined,

  methods: {
    verifySignatures: {
      privateInputs: [
        Batch,
        ApprovalVerdicts,
        Field,
        Field,
        VoteExtBody,
        SignaturePublicKeyList,
        ApprovalTailProof,
      ],
      async method(
        publicInput: ApprovalQuorumPublicInput,
        batch: Batch,
        verdicts: ApprovalVerdicts,
        fromActionState: Field,
        cursorBefore: Field,
        body: VoteExtBody,
        signaturePublicKeyList: SignaturePublicKeyList,
        tailProof: ApprovalTailProof
      ) {
        // The batch's two cursors, folded in lockstep — the same isDummy
        // guard drives both, so they advance by the same count and cannot
        // drift (the alignment invariant). Dummy slots contribute to
        // neither. This is the loop that used to live in reduce.
        let actionState = fromActionState;
        let approvalCursor = cursorBefore;

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

          // Chain cursor: one v2 verdict leaf per consumed slot. The verdict
          // is not chosen here: with the actions pinned by the action-state
          // endpoints, only the chain's own verdict vector folds to a cursor
          // the tail below can extend to a signed root.
          const leaf = hashPulsarActionLeafV2(action, verdicts.list[i]);
          approvalCursor = Provable.if(
            isDummy,
            approvalCursor,
            foldApprovalCursor(approvalCursor, leaf)
          );
        }

        // The whole endpoint tuple — witnessed starts, computed ends, the
        // packed verdict vector — collapses into the single public
        // commitment the contract recomputes from its own values. Equality
        // of the hash IS equality of all five values (collision
        // resistance), so the contract's batch, verdicts and cursor slots
        // are bound to this fold without widening the public input.
        reduceCommitmentHash({
          fromActionState,
          endActionState: actionState,
          cursorBefore,
          cursorAfter: approvalCursor,
          verdictsPacked: verdicts.toField(),
        }).assertEquals(
          publicInput.reduceCommitment,
          'Batch fold must match the public reduce commitment'
        );

        // The verdict binding of the whole design: the cursor the batch
        // reaches, extended leaf by leaf by the tail proof, must terminate
        // at the exact root the quorum signed. An empty tail is a real base
        // proof over an all-dummy queue (output == input), so this
        // verification is unconditional — no dummy-proof branch.
        tailProof.verify();
        tailProof.publicInput.assertEquals(
          approvalCursor,
          'Tail proof must extend the batch-end approval cursor'
        );
        tailProof.publicOutput.assertEquals(
          body.actionsReducedRoot,
          'Tail proof must terminate at the signed actionsReducedRoot'
        );

        // The signed body's validator-set root IS the public one — the
        // reduce pins publicInput.validatorSetRoot to contract slot 1, and
        // this equality carries that pin onto the signed body.
        body.nextValidatorSetHash.assertEquals(
          publicInput.validatorSetRoot,
          'Signed body must carry the public validator-set root'
        );

        let accumulatedPower = Field.from(0);
        let totalPower = Field.from(0);
        let list = List.empty();
        // One field element — the exact value SignFieldElement covers in
        // abci/signing.go:52, so real chain signatures verify unchanged.
        const signatureMessage = [body.hash()];

        // VALIDATOR_NUMBER is baked into an immutable verification key, so
        // the deployed contract is pinned to a chain with exactly this many
        // validators forever. 3 matches lightnet/devnet today; the mainnet
        // arity (or a recursive validator-set fold that removes the limit)
        // is an open gating decision that MUST be settled before the VK freezes at launch.
        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          const { signature, publicKey, power } =
            signaturePublicKeyList.list[i];
          // Non-signing slots carry the well-formed dummy Signature
          // {r: 1, s: 1}: verify() returns false, but the slot's key and
          // power still enter the fold below, so the root check always
          // covers the FULL committed set, never just the signers.
          const isValid = signature.verify(publicKey, signatureMessage);
          accumulatedPower = Provable.if(
            isValid,
            accumulatedPower.add(power),
            accumulatedPower
          );
          totalPower = totalPower.add(power);

          // The list arrives pre-sorted in the chain's fold order (power
          // ASC, then consensus-address ASC) and is folded as given, exactly
          // like ValidateReduce — the circuit never sorts.
          list.push(hashValidatorLeaf(publicKey, power));
        }

        // Authenticates the signer set against the public root (== the
        // signed body's root, asserted above). This is self-consistent
        // only: the reduce must additionally pin
        // publicInput.validatorSetRoot to contract slot 1, or a prover
        // could invent an entire validator set.
        list.hash.assertEquals(
          publicInput.validatorSetRoot,
          "Validator MerkleList hash doesn't match"
        );
        // Parity with hasAtLeastTwoThirdsPower (abci/quorum.go:129-131),
        // which returns false when totalPower <= 0: a zero-power set would
        // satisfy 0 * 3 >= 0 * 2 vacuously WITH ZERO VALID SIGNATURES, so
        // the guard is load-bearing, not cosmetic.
        totalPower.assertGreaterThan(0, 'Total voting power must be positive');
        // 2/3 voting-power quorum: signed power / total power >= 2/3
        accumulatedPower
          .mul(3)
          .assertGreaterThanOrEqual(
            totalPower.mul(2),
            'Not enough signed voting power (< 2/3)'
          );
      },
    },
  },
});

class ApprovalQuorumProof extends ZkProgram.Proof(ApprovalQuorumProgram) {}
