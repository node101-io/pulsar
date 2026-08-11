import { Field, Poseidon, ZkProgram } from 'o1js';
import {
  SettlementProof,
  SettlementPublicInputs,
} from './SettlementProof.js';

export { SettleAttestProof, SettleAttestProgram, settleAttestCommitment };

/**
 * The commitment the attest proof carries as its ONE public field: the
 * settlement proof's six public values compressed with proven in-contract
 * hash shapes (a 5-input plain Poseidon chained into a 2-input one — the
 * 2026-08-11 wrap-bug hunt showed those exact shapes prove inside
 * SettlementContract methods while richer shapes do not). Shared by the
 * program and the contract so the two sides cannot drift.
 */
function settleAttestCommitment(publicInput: SettlementPublicInputs): Field {
  const head = Poseidon.hash([
    publicInput.InitialMerkleListRoot,
    publicInput.InitialStateRoot,
    publicInput.InitialBlockHeight,
    publicInput.NewMerkleListRoot,
    publicInput.NewStateRoot,
  ]);
  return Poseidon.hash([head, publicInput.NewBlockHeight]);
}

/**
 * Adapter between the settlement pipeline and the contract, existing ONLY
 * because of the o1js 2.10–2.15 wrap bug: a contract branch that verifies
 * MultisigVerifier's SettlementProof directly makes the REDUCE branch's
 * wrap unsatisfiable once reduce verifies the batch-folding
 * ApprovalQuorumProgram (bisected 2026-08-11: remove either side and the
 * other proves fine; every size/publicInput variation failed). Wrapping the
 * settlement proof in this small mpv-1 program with a single-field public
 * input moves settle's verified-proof profile into the class that provably
 * coexists (the ApprovalQuorum→ApprovalTail relationship is the same
 * shape). When the upstream bug is fixed, this program can be deleted and
 * settle can verify SettlementProof directly again — at the cost of a VK
 * change.
 *
 * Security is unchanged: the commitment pins ALL six public values, so the
 * contract's settle arguments are exactly the values the underlying
 * settlement proof attested — any drift breaks the hash equality.
 */
const SettleAttestProgram = ZkProgram({
  name: 'SettleAttest',
  publicInput: Field,

  methods: {
    attest: {
      privateInputs: [SettlementProof],
      async method(attestCommitment: Field, settlementProof: SettlementProof) {
        settlementProof.verify();
        settleAttestCommitment(settlementProof.publicInput).assertEquals(
          attestCommitment,
          'Attest commitment must hash the settlement proof public input'
        );
      },
    },
  },
});

class SettleAttestProof extends ZkProgram.Proof(SettleAttestProgram) {}
