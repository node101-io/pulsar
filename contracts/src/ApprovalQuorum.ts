import { Field, Provable, Struct, ZkProgram } from 'o1js';
import { VALIDATOR_NUMBER } from './utils/constants.js';
import { SignaturePublicKeyList } from './types/signaturePubKeyList.js';
import { List } from './types/common.js';
import { hashValidatorLeaf } from './utils/validatorList.js';
import { VoteExtBody } from './types/voteExtBody.js';
import { ApprovalTailProof } from './ApprovalTail.js';

export { ApprovalQuorumProof, ApprovalQuorumPublicInput, ApprovalQuorumProgram };

/**
 * What the tranche-2 reduce reads off the proof: the validator-set root to pin against
 * contract slot 1, and the approval cursor the contract reaches after
 * folding the batch. Everything else about the signed body stays a private
 * witness — the Schnorr signature binds all body fields jointly, so any
 * body that verifies is a body the quorum attested to.
 */
class ApprovalQuorumPublicInput extends Struct({
  validatorSetRoot: Field,
  cursorAfter: Field,
}) {}

/**
 * Proves that >= 2/3 of a validator set's voting power signed one vote-
 * extension body — the message Pulsar validators ALREADY sign every block in
 * ExtendVote — AND that the batch-end approval cursor
 * (publicInput.cursorAfter) extends to that body's signed actionsReducedRoot
 * via the tail proof. Successor to ValidateReduceProgram, which demands a
 * signature over a bridge-invented batch commitment that nothing chain-side
 * produces; both coexist until the contract swap in tranche 2.
 *
 * The tail proof is consumed HERE, not by the contract: reduce must keep
 * verifying exactly two proofs (this one and the action stack — the Pickles
 * limit), so the cursor-to-signed-root linkage has to live inside this
 * program. Without it a prover could pair any quorum-signed body with a
 * batch whose cursor never reaches that body's root.
 */
const ApprovalQuorumProgram = ZkProgram({
  name: 'ApprovalQuorum',
  publicInput: ApprovalQuorumPublicInput,
  publicOutput: undefined,

  methods: {
    verifySignatures: {
      privateInputs: [VoteExtBody, SignaturePublicKeyList, ApprovalTailProof],
      async method(
        publicInput: ApprovalQuorumPublicInput,
        body: VoteExtBody,
        signaturePublicKeyList: SignaturePublicKeyList,
        tailProof: ApprovalTailProof
      ) {
        // The verdict binding of the whole design: the cursor the contract
        // reaches after the batch, extended leaf by leaf by the tail proof,
        // must terminate at the exact root the quorum signed. An empty tail
        // is a real base proof over an all-dummy queue (output == input),
        // so this verification is unconditional — no dummy-proof branch.
        tailProof.verify();
        tailProof.publicInput.assertEquals(
          publicInput.cursorAfter,
          'Tail proof must extend the batch-end approval cursor'
        );
        tailProof.publicOutput.assertEquals(
          body.actionsReducedRoot,
          'Tail proof must terminate at the signed actionsReducedRoot'
        );

        // The signed body's validator-set root IS the public one — the
        // tranche-2 reduce pins publicInput.validatorSetRoot to contract
        // slot 1, and this equality carries that pin onto the signed body.
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
        // only: the tranche-2 reduce must additionally pin
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
