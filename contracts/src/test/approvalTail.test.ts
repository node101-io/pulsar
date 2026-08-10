import { Field, VerificationKey, verify } from 'o1js';
import { ApprovalTailProgram, ApprovalTailQueue } from '../ApprovalTail';
import { GenerateApprovalTailProof } from '../utils/generateFunctions';
import { foldApprovalCursor } from '../utils/pulsarActionLeaf';
import { APPROVAL_TAIL_CHUNK } from '../utils/constants';
import { enableLogs, log } from '../utils/loggers';

describe('Approval Tail Proof tests', () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === '1';
  let vk: VerificationKey;

  if (process.env.LOGS_ENABLED === '1') {
    enableLogs();
  }

  // Never Field(0): the reduce always anchors on the contract's committed
  // cursor, and Field(0) would mask an accidental empty-state fallback.
  const anchor = Field(
    '12345678901234567890123456789012345678901234567890123456789012345678901234'
  );

  function randomLeaves(count: number): Field[] {
    return Array.from({ length: count }, () => Field.random());
  }

  function foldAll(fromCursor: Field, leaves: Field[]): Field {
    return leaves.reduce(
      (cursor, leaf) => foldApprovalCursor(cursor, leaf),
      fromCursor
    );
  }

  beforeAll(async () => {
    const analysis = await ApprovalTailProgram.analyzeMethods();
    console.log(
      `ApprovalTailProgram rows (APPROVAL_TAIL_CHUNK = ${APPROVAL_TAIL_CHUNK}): ` +
        `proveBase ${analysis.proveBase.rows}, proveRecursive ${analysis.proveRecursive.rows}`
    );

    vk = (
      await ApprovalTailProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;
  });

  describe('ApprovalTailQueue Struct', () => {
    it('should create an ApprovalTailQueue from an array of leaves, dummy-padded', () => {
      const leaves = randomLeaves(APPROVAL_TAIL_CHUNK - 5);
      const queue = ApprovalTailQueue.fromLeaves(leaves);
      expect(queue.entries.length).toBe(APPROVAL_TAIL_CHUNK);
      expect(
        queue.entries
          .slice(0, leaves.length)
          .every(
            (entry, i) =>
              !entry.isDummy.toBoolean() &&
              entry.leaf.equals(leaves[i]).toBoolean()
          )
      ).toBe(true);
      expect(
        queue.entries
          .slice(leaves.length)
          .every((entry) => entry.isDummy.toBoolean())
      ).toBe(true);
    });

    it('should throw an error if too many leaves are provided', () => {
      expect(() =>
        ApprovalTailQueue.fromLeaves(randomLeaves(APPROVAL_TAIL_CHUNK + 1))
      ).toThrow(`Too many leaves, max is ${APPROVAL_TAIL_CHUNK}`);
    });
  });

  describe('GenerateApprovalTailProof', () => {
    it('should fold a partial base chunk from the anchor to the target root', async () => {
      const leaves = randomLeaves(Math.floor(APPROVAL_TAIL_CHUNK / 2) + 3);
      const targetRoot = foldAll(anchor, leaves);

      const start = performance.now();
      const proof = await GenerateApprovalTailProof(anchor, leaves);
      log(`Base tail proof took ${performance.now() - start} ms`);

      if (proofsEnabled) {
        expect(await verify(proof, vk)).toBe(true);
      }
      expect(proof.publicInput).toEqual(anchor);
      expect(proof.publicOutput).toEqual(targetRoot);
    });

    it('should fold a two-layer tail and expose the ORIGINAL anchor', async () => {
      const leaves = randomLeaves(APPROVAL_TAIL_CHUNK + 41);
      const targetRoot = foldAll(anchor, leaves);

      const start = performance.now();
      const proof = await GenerateApprovalTailProof(anchor, leaves);
      log(`Two-layer tail proof took ${performance.now() - start} ms`);

      if (proofsEnabled) {
        expect(await verify(proof, vk)).toBe(true);
      }
      // The anchor-carry regression: the FINAL layer's publicInput must be
      // the batch-end cursor, not the intermediate fold after layer one.
      expect(proof.publicInput).toEqual(anchor);
      expect(proof.publicOutput).toEqual(targetRoot);
    });

    it('should prove the empty tail as identity (publicOutput == publicInput)', async () => {
      const proof = await GenerateApprovalTailProof(anchor, []);

      if (proofsEnabled) {
        expect(await verify(proof, vk)).toBe(true);
      }
      expect(proof.publicInput).toEqual(anchor);
      expect(proof.publicOutput).toEqual(anchor);
    });
  });

  describe('anchor discipline', () => {
    it('should reject a recursive layer whose anchor is not the base anchor', async () => {
      const baseProof = (
        await ApprovalTailProgram.proveBase(
          anchor,
          ApprovalTailQueue.fromLeaves(randomLeaves(3))
        )
      ).proof;

      // Passing the running fold (or anything != the original anchor) into
      // the next layer must fail the in-circuit assertEquals — this is the
      // exact defect once fixed in ActionStackProgram.
      await expect(
        ApprovalTailProgram.proveRecursive(
          baseProof.publicOutput,
          baseProof,
          ApprovalTailQueue.fromLeaves(randomLeaves(3))
        )
      ).rejects.toThrow();
    });
  });
});
