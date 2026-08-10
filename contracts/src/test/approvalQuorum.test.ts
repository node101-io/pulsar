import { readFileSync } from 'fs';
import { join } from 'path';
import { Field, PublicKey, Signature, VerificationKey, verify } from 'o1js';
import {
  ApprovalQuorumProgram,
  ApprovalQuorumProof,
  ApprovalQuorumPublicInput,
} from '../ApprovalQuorum';
import {
  ApprovalTailProgram,
  ApprovalTailProof,
  ApprovalTailQueue,
} from '../ApprovalTail';
import {
  GenerateApprovalQuorumProof,
  GenerateApprovalTailProof,
} from '../utils/generateFunctions';
import { VoteExtBody } from '../types/voteExtBody';
import { SignaturePublicKeyList } from '../types/signaturePubKeyList';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { computeValidatorListHash } from '../utils/validatorList';
import { foldApprovalCursor } from '../utils/pulsarActionLeaf';
import { TestUtils } from '../utils/testUtils';
import { validatorSet } from './mock';
import { enableLogs, log } from '../utils/loggers';

type QuorumValidator = {
  publicKeyBase58: string;
  power: string;
  signature: { r: string; s: string };
};

type QuorumVector = {
  description: string;
  wire: {
    nextValidatorSetHashBase64: string;
    appHashBase64: string;
    currentBlockHeight: string;
    actionsReducedRootBase64: string;
  };
  fields: { nextValidatorSetHash: string; actionsReducedRoot: string };
  msgHash: string;
  validators: QuorumValidator[];
};

// jest runs from the contracts package root, like seed.ts reads deploy-result.json
const fixture: { quorum: QuorumVector } = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/test/fixtures/voteExtBody.vectors.json'),
    'utf-8'
  )
);
const quorum = fixture.quorum;

// The whole point of this suite is a REAL Kimchi proof over a REAL
// chain-produced signature set — the single most valuable test of the
// redesign — so unlike the other suites
// proofs default ON here; PROOFS_ENABLED=0 opts out for quick iteration.
const proofsEnabled = process.env.PROOFS_ENABLED !== '0';

// The well-formed dummy for a non-signing slot — same convention as the
// bridge's buildSignatureList: never verifies, but keeps the slot occupied so
// the circuit still folds the full validator list.
const dummySignature = () => Signature.fromValue({ r: 1n, s: 1n });

function quorumBody(): VoteExtBody {
  return VoteExtBody.fromWire({
    nextValidatorSetHash: Uint8Array.from(
      Buffer.from(quorum.wire.nextValidatorSetHashBase64, 'base64')
    ),
    currentStateRoot: Uint8Array.from(
      Buffer.from(quorum.wire.appHashBase64, 'base64')
    ),
    currentBlockHeight: BigInt(quorum.wire.currentBlockHeight),
    actionsReducedRoot: Uint8Array.from(
      Buffer.from(quorum.wire.actionsReducedRootBase64, 'base64')
    ),
  });
}

/**
 * Fixture order IS the chain fold order (power ASC, then consensus-address
 * ASC) — the list is passed to the circuit as given, never sorted here.
 * Slots outside `signerIndices` get the dummy signature.
 */
function signatureList(signerIndices: number[]): SignaturePublicKeyList {
  return SignaturePublicKeyList.fromArray(
    quorum.validators.map((validator, i) => [
      signerIndices.includes(i)
        ? Signature.fromValue({
            r: BigInt(validator.signature.r),
            s: BigInt(validator.signature.s),
          })
        : dummySignature(),
      PublicKey.fromBase58(validator.publicKeyBase58),
      Field(validator.power),
    ])
  );
}

function publicInputFor(
  body: VoteExtBody,
  cursorAfter: Field
): ApprovalQuorumPublicInput {
  return new ApprovalQuorumPublicInput({
    validatorSetRoot: body.nextValidatorSetHash,
    cursorAfter,
  });
}

describe('ApprovalQuorumProgram', () => {
  let vk: VerificationKey;
  let rows: number;
  // The signed root of the real fixture body — the anchor most tests reuse.
  const signedRoot = Field(quorum.fields.actionsReducedRoot);
  // Empty-tail proofs are REAL base proofs over an all-dummy queue
  // (publicOutput == publicInput), shared across tests per anchor.
  let tailAtSignedRoot: ApprovalTailProof;
  let tailAtSignedRootPlusOne: ApprovalTailProof;
  if (process.env.LOGS_ENABLED === '1') {
    enableLogs();
  }

  beforeAll(async () => {
    const analysis = await ApprovalQuorumProgram.analyzeMethods();
    rows = analysis.verifySignatures.rows;
    log('ApprovalQuorumProgram.verifySignatures rows:', rows);

    // The quorum program verifies an ApprovalTailProof, so the tail program
    // must be compiled first — same dependency order as the reduce script.
    await ApprovalTailProgram.compile({ proofsEnabled });
    vk = (await ApprovalQuorumProgram.compile({ proofsEnabled }))
      .verificationKey;

    tailAtSignedRoot = (
      await ApprovalTailProgram.proveBase(signedRoot, ApprovalTailQueue.empty())
    ).proof;
    tailAtSignedRootPlusOne = (
      await ApprovalTailProgram.proveBase(
        signedRoot.add(1),
        ApprovalTailQueue.empty()
      )
    ).proof;
  });

  describe('fixture sanity (out-of-circuit, pins the Go mirrors)', () => {
    it(`carries exactly VALIDATOR_NUMBER = ${VALIDATOR_NUMBER} validators`, () => {
      // The circuit arity is compile-time; a VALIDATOR_NUMBER change means
      // the quorum vector must be regenerated with that many signers.
      expect(quorum.validators.length).toBe(VALIDATOR_NUMBER);
    });

    it("folds the fixture validators to the body's nextValidatorSetHash via validatorList.ts", () => {
      // Pins the generator's mirror of the chain's calculateValidatorSetRoot
      // to our single-source leaf convention: same leaf, same seed, same fold.
      const root = computeValidatorListHash(
        quorum.validators.map((validator) => ({
          publicKey: PublicKey.fromBase58(validator.publicKeyBase58),
          power: Field(validator.power),
        }))
      );
      expect(root.toString()).toBe(quorum.fields.nextValidatorSetHash);
      expect(root.toString()).toBe(
        quorumBody().nextValidatorSetHash.toString()
      );
    });

    it('reproduces msgHash and verifies every chain signature out-of-circuit', () => {
      const body = quorumBody();
      expect(body.hash().toString()).toBe(quorum.msgHash);

      // Cheap per-signer guard so an in-circuit failure below is
      // attributable to the circuit, not to a bad fixture entry.
      for (const validator of quorum.validators) {
        const signature = Signature.fromValue({
          r: BigInt(validator.signature.r),
          s: BigInt(validator.signature.s),
        });
        const publicKey = PublicKey.fromBase58(validator.publicKeyBase58);
        expect(signature.verify(publicKey, [body.hash()]).toBoolean()).toBe(
          true
        );
      }
    });

    it('stays within the 65,536-row method limit', () => {
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(65536);
    });
  });

  describe('in-circuit acceptance of real chain signatures', () => {
    let proof: ApprovalQuorumProof;

    // THE flagship test of the redesign: the signatures were produced by the
    // chain's real signing entry point (abci.SecondaryKey.SignVoteExtBody)
    // over a body whose validator-set root is the chain-convention fold of
    // the very keys that signed — acceptance proves the circuit verifies the
    // message the chain actually signs, with no stub signer anywhere. The
    // batch consumes the whole signed prefix here, so cursorAfter is the
    // signed root itself and the tail is the empty identity proof.
    it('proves a full 3-of-3 real-signature quorum', async () => {
      const body = quorumBody();

      const start = performance.now();
      proof = (
        await ApprovalQuorumProgram.verifySignatures(
          publicInputFor(body, signedRoot),
          body,
          signatureList([0, 1, 2]),
          tailAtSignedRoot
        )
      ).proof;
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');

      // The public input is exactly what the tranche-2 reduce reads off the
      // proof: slot-1 pin and batch-end cursor — assert they survive.
      expect(proof.publicInput.validatorSetRoot.toString()).toBe(
        quorum.fields.nextValidatorSetHash
      );
      expect(proof.publicInput.cursorAfter.toString()).toBe(
        quorum.fields.actionsReducedRoot
      );
    });

    it('verifies the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const isValid = await verify(proof, vk);
      expect(isValid).toBe(true);
    });

    it('proves a 2-of-3 quorum at the exact 2/3 power boundary, dummy slot inside', async () => {
      // Powers 1 + 3 of total 6: signed * 3 == total * 2 exactly, and the
      // middle slot carries the dummy Signature{r:1,s:1} — the accepted
      // proof shows the >= boundary and the non-signer convention together.
      const proof2 = (
        await ApprovalQuorumProgram.verifySignatures(
          publicInputFor(quorumBody(), signedRoot),
          quorumBody(),
          signatureList([0, 2]),
          tailAtSignedRoot
        )
      ).proof;

      if (proofsEnabled) {
        expect(await verify(proof2, vk)).toBe(true);
      }
    });

    it('proves a batch-end cursor that a NON-empty tail extends to the signed root', async () => {
      // The verdict-binding path the reduce relies on: the contract stops
      // mid-prefix at cursorAfter and the tail folds the remaining leaves up
      // to the root the quorum signed. The chain fixture pins a fixed root
      // with no tail preimages, so this case uses mock validators over a
      // synthetic body whose root IS a known fold — the signature mechanics
      // are identical, only the keys are local.
      const cursorAfter = Field(
        '987654321098765432109876543210987654321098765432109876543210'
      );
      const tailLeaves = [Field.random(), Field.random(), Field.random()];
      const root = tailLeaves.reduce(
        (cursor, leaf) => foldApprovalCursor(cursor, leaf),
        cursorAfter
      );

      const mockSigners = validatorSet.slice(0, VALIDATOR_NUMBER);
      const body = new VoteExtBody({
        // power Field(1) matches TestUtils.GenerateSignaturePubKeyList
        nextValidatorSetHash: computeValidatorListHash(
          mockSigners.map(([, publicKey]) => ({ publicKey, power: Field(1) }))
        ),
        stateRootHi: Field(123),
        stateRootLo: Field(456),
        currentBlockHeight: Field(42),
        actionsReducedRoot: root,
      });

      const proof3 = await GenerateApprovalQuorumProof(
        cursorAfter,
        body,
        TestUtils.GenerateSignaturePubKeyList([body.hash()], mockSigners),
        await GenerateApprovalTailProof(cursorAfter, tailLeaves)
      );

      expect(proof3.publicInput.cursorAfter.toString()).toBe(
        cursorAfter.toString()
      );
      if (proofsEnabled) {
        expect(await verify(proof3, vk)).toBe(true);
      }
    });
  });

  describe('rejections', () => {
    it('rejects a 1-of-3 power quorum (power 2 of total 6)', async () => {
      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(quorumBody(), signedRoot),
          quorumBody(),
          signatureList([1]),
          tailAtSignedRoot
        )
      ).rejects.toThrow('Not enough signed voting power');
    });

    it('rejects a validator set that does not fold to the signed body root', async () => {
      // Local mock validators DO produce valid signatures over the real
      // body hash and DO reach quorum among themselves — the one and only
      // failing check is their fold against the public validator-set root.
      // Without that check a prover could invent an entire validator set.
      const body = quorumBody();
      const impostors = TestUtils.GenerateSignaturePubKeyList(
        [body.hash()],
        validatorSet.slice(0, VALIDATOR_NUMBER)
      );

      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(body, signedRoot),
          body,
          impostors,
          tailAtSignedRoot
        )
      ).rejects.toThrow("Validator MerkleList hash doesn't match");
    });

    it('rejects a tampered body field: the joint hash invalidates every signature', async () => {
      const body = quorumBody();
      // actionsReducedRoot is the money field — the approval cursor target
      // the tranche-2 contract will pay against. The tail is anchored at the
      // TAMPERED root so both tail checks pass and the failure is
      // attributable to the signatures alone.
      const tampered = new VoteExtBody({
        ...body,
        actionsReducedRoot: body.actionsReducedRoot.add(1),
      });

      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(tampered, signedRoot.add(1)),
          tampered,
          signatureList([0, 1, 2]),
          tailAtSignedRootPlusOne
        )
      ).rejects.toThrow('Not enough signed voting power');
    });

    it('rejects a tail proof anchored anywhere but the batch-end cursor', async () => {
      // The cursorAfter binding: without it a prover could pair a quorum-signed
      // body with a batch whose cursor never extends to that body's root.
      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(quorumBody(), signedRoot),
          quorumBody(),
          signatureList([0, 1, 2]),
          // anchored at signedRoot + 1, cursorAfter says signedRoot
          tailAtSignedRootPlusOne
        )
      ).rejects.toThrow('Tail proof must extend the batch-end approval cursor');
    });

    it('rejects a tail whose terminus is not the signed actionsReducedRoot', async () => {
      // Tail correctly anchored at cursorAfter, but its terminal root is not
      // the root the quorum signed — the other half of the verdict binding.
      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(quorumBody(), signedRoot.add(1)),
          quorumBody(),
          signatureList([0, 1, 2]),
          tailAtSignedRootPlusOne
        )
      ).rejects.toThrow(
        'Tail proof must terminate at the signed actionsReducedRoot'
      );
    });

    it('rejects a public validator-set root that differs from the signed one', async () => {
      const body = quorumBody();

      await expect(
        ApprovalQuorumProgram.verifySignatures(
          new ApprovalQuorumPublicInput({
            validatorSetRoot: body.nextValidatorSetHash.add(1),
            cursorAfter: signedRoot,
          }),
          body,
          signatureList([0, 1, 2]),
          tailAtSignedRoot
        )
      ).rejects.toThrow('Signed body must carry the public validator-set root');
    });

    it('rejects a zero-total-power validator set instead of passing vacuously', async () => {
      // Parity with hasAtLeastTwoThirdsPower (abci/quorum.go:129-131): a
      // mis-seeded set whose three leaves all carry power 0 satisfies
      // 0 * 3 >= 0 * 2 with ZERO valid signatures — three dummy signatures
      // and a self-consistent zero-power fold would otherwise prove an
      // arbitrary body, actionsReducedRoot included.
      const zeroPowerSet = validatorSet
        .slice(0, VALIDATOR_NUMBER)
        .map(([, publicKey]) => publicKey);
      const body = new VoteExtBody({
        nextValidatorSetHash: computeValidatorListHash(
          zeroPowerSet.map((publicKey) => ({ publicKey, power: Field(0) }))
        ),
        stateRootHi: Field(123),
        stateRootLo: Field(456),
        currentBlockHeight: Field(42),
        // reuse the shared empty tail by targeting the fixture root
        actionsReducedRoot: signedRoot,
      });

      await expect(
        ApprovalQuorumProgram.verifySignatures(
          publicInputFor(body, signedRoot),
          body,
          SignaturePublicKeyList.fromArray(
            zeroPowerSet.map(
              (publicKey) =>
                [dummySignature(), publicKey, Field(0)] as [
                  Signature,
                  PublicKey,
                  Field
                ]
            )
          ),
          tailAtSignedRoot
        )
      ).rejects.toThrow('Total voting power must be positive');
    });
  });
});
