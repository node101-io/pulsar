import { Bool, Field, Provable, SelfProof, Struct, ZkProgram } from 'o1js';
import { foldApprovalCursor } from './utils/pulsarActionLeaf.js';
import { APPROVAL_TAIL_CHUNK } from './utils/constants.js';

export {
  ApprovalTailProof,
  ApprovalTailEntry,
  ApprovalTailQueue,
  ApprovalTailProgram,
};

/**
 * Extends the batch's end approval cursor (publicInput) by folding v2 verdict
 * leaves until it reaches a quorum-signed actions_reduced_root (publicOutput).
 * Structurally a copy of ActionStackProgram: recursion absorbs an
 * arbitrary-length tail in APPROVAL_TAIL_CHUNK-sized steps.
 *
 * The leaves are unconstrained witnesses on purpose: the anchor is pinned
 * below by the contract's cursor and the terminal root is pinned above by a
 * validator signature, so by collision resistance of the fold the only
 * sequence connecting the two endpoints is the chain's real one.
 *
 * An empty tail is a REAL base proof over an all-dummy queue
 * (publicOutput == publicInput) — no dummy proof, no hasTail flag.
 */
class ApprovalTailEntry extends Struct({
  isDummy: Bool,
  leaf: Field,
}) {}

class ApprovalTailQueue extends Struct({
  entries: Provable.Array(ApprovalTailEntry, APPROVAL_TAIL_CHUNK),
}) {
  static empty() {
    return new this({
      entries: Array(APPROVAL_TAIL_CHUNK).fill(
        new ApprovalTailEntry({ isDummy: Bool(true), leaf: Field(0) })
      ),
    });
  }

  static fromLeaves(leaves: Field[]) {
    if (leaves.length > APPROVAL_TAIL_CHUNK) {
      throw new Error(`Too many leaves, max is ${APPROVAL_TAIL_CHUNK}`);
    }
    const entries = ApprovalTailQueue.empty().entries;
    for (let i = 0; i < leaves.length; i++) {
      entries[i] = new ApprovalTailEntry({
        isDummy: Bool(false),
        leaf: leaves[i],
      });
    }
    return new this({ entries });
  }

  toJSON() {
    return this.entries.map((entry) => ({
      isDummy: entry.isDummy.toBoolean(),
      leaf: entry.leaf.toString(),
    }));
  }
}

const ApprovalTailProgram = ZkProgram({
  name: 'ApprovalTail',
  publicInput: Field,
  publicOutput: Field,
  methods: {
    proveBase: {
      privateInputs: [ApprovalTailQueue],
      async method(anchor: Field, queue: ApprovalTailQueue) {
        let root = anchor;
        for (let i = 0; i < APPROVAL_TAIL_CHUNK; i++) {
          const entry = queue.entries[i];
          root = Provable.if(
            entry.isDummy,
            root,
            foldApprovalCursor(root, entry.leaf)
          );
        }

        return {
          publicOutput: root,
        };
      },
    },

    proveRecursive: {
      privateInputs: [SelfProof<Field, Field>, ApprovalTailQueue],
      async method(
        anchor: Field,
        proofSoFar: SelfProof<Field, Field>,
        queue: ApprovalTailQueue
      ) {
        proofSoFar.verify();
        // The anchor must survive every recursion layer: ApprovalQuorumProgram
        // asserts the FINAL proof's publicInput equals the batch-end approval
        // cursor, so each layer re-exposes the original anchor and resumes
        // folding from the previous layer's end (the ActionStackProgram
        // anchor-carry discipline).
        anchor.assertEquals(proofSoFar.publicInput);

        let root = proofSoFar.publicOutput;

        for (let i = 0; i < APPROVAL_TAIL_CHUNK; i++) {
          const entry = queue.entries[i];
          root = Provable.if(
            entry.isDummy,
            root,
            foldApprovalCursor(root, entry.leaf)
          );
        }

        return {
          publicOutput: root,
        };
      },
    },
  },
});

class ApprovalTailProof extends ZkProgram.Proof(ApprovalTailProgram) {}
