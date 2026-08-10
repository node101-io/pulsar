import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Bool,
  Field,
  PrivateKey,
  PublicKey,
  ZkProgram,
  verify,
} from 'o1js';
import { PulsarAction, PulsarAuth } from '../types/PulsarAction';
import * as pulsarActionLeaf from '../utils/pulsarActionLeaf';
import {
  hashPulsarActionLeafV2,
  foldApprovalCursor,
} from '../utils/pulsarActionLeaf';

type LeafVector = {
  approved: string;
  account: string;
  type: string;
  amount: string;
  expected: string;
};

type FoldVector = {
  fromCursor: string;
  leaves: string[];
  expected: string;
};

// jest runs from the contracts package root, like seed.ts reads deploy-result.json
const fixture: { leaves: LeafVector[]; folds: FoldVector[] } = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/test/fixtures/pulsarActionLeafV2.vectors.json'),
    'utf-8'
  )
);

function actionFromVector(vector: LeafVector): PulsarAction {
  return new PulsarAction({
    type: Field(vector.type),
    account: PublicKey.fromBase58(vector.account),
    amount: Field(vector.amount),
    pulsarAuth: PulsarAuth.empty(),
  });
}

/**
 * Provability smoke: the same functions the bridge calls out-of-circuit must
 * synthesize inside a circuit on fully witnessed inputs — one leaf hashed
 * under a witnessed verdict, folded onto a witnessed cursor.
 */
const LeafV2SmokeProgram = ZkProgram({
  name: 'pulsar-action-leaf-v2-smoke',
  publicOutput: Field,
  methods: {
    hashAndFold: {
      privateInputs: [PulsarAction, Bool, Field],
      async method(action: PulsarAction, approved: Bool, cursor: Field) {
        const leaf = hashPulsarActionLeafV2(action, approved);
        return { publicOutput: foldApprovalCursor(cursor, leaf) };
      },
    },
  },
});

describe('pulsarActionLeaf v2 verdict-leaf convention', () => {
  describe('export surface', () => {
    // The redesign deleted the v1 convention
    // (hashPulsarActionLeaf and the height parameter are deleted). Exporting
    // both would leave the shorter, un-suffixed v1 names one hasty import away
    // from a fold that never matches any chain root — so pin v2 as the ONLY
    // convention this module offers.
    it('exports the v2 convention and nothing else', () => {
      expect(Object.keys(pulsarActionLeaf).sort()).toEqual([
        'ACTION_LEAF_PREFIX_V2',
        'APPROVAL_CURSOR_PREFIX_V2',
        'foldApprovalCursor',
        'hashPulsarActionLeafV2',
      ]);
    });
  });

  describe('hashPulsarActionLeafV2 against Go-generated vectors', () => {
    fixture.leaves.forEach((vector, i) => {
      it(`reproduces leaf vector ${i} (approved ${vector.approved}, type ${vector.type})`, () => {
        const leaf = hashPulsarActionLeafV2(
          actionFromVector(vector),
          Bool(vector.approved === '1')
        );
        expect(leaf.toString()).toBe(vector.expected);
      });
    });
  });

  describe('foldApprovalCursor against Go-generated vectors', () => {
    fixture.folds.forEach((vector, i) => {
      it(`reproduces fold vector ${i} (${vector.leaves.length} leaves from cursor ${vector.fromCursor})`, () => {
        let cursor = Field(vector.fromCursor);
        for (const leaf of vector.leaves) {
          cursor = foldApprovalCursor(cursor, Field(leaf));
        }
        expect(cursor.toString()).toBe(vector.expected);
      });
    });

    it('fixture pins an empty fold that returns the input cursor', () => {
      const empty = fixture.folds.find((v) => v.leaves.length === 0);
      expect(empty).toBeDefined();
      expect(empty!.fromCursor).not.toBe('0');
      expect(empty!.expected).toBe(empty!.fromCursor);
    });
  });

  describe('structural properties', () => {
    const account = PrivateKey.fromBigInt(42n).toPublicKey();
    const deposit = PulsarAction.deposit(
      account,
      Field(1000),
      PulsarAuth.empty()
    );
    const withdrawal = PulsarAction.withdrawal(account, Field(1000));

    it('the verdict flips the leaf', () => {
      const approved = hashPulsarActionLeafV2(deposit, Bool(true));
      const rejected = hashPulsarActionLeafV2(deposit, Bool(false));
      expect(approved.toString()).not.toBe(rejected.toString());
    });

    it('duplicate content under the same verdict hashes to the same leaf', () => {
      const copy = PulsarAction.deposit(account, Field(1000), PulsarAuth.empty());
      expect(hashPulsarActionLeafV2(deposit, Bool(true)).toString()).toBe(
        hashPulsarActionLeafV2(copy, Bool(true)).toString()
      );

      // and the fixture pins the same fact from the Go side: the duplicate
      // content pair (indices 1 and 6) carries identical expected leaves.
      expect(fixture.leaves[6].expected).toBe(fixture.leaves[1].expected);
    });

    it('deposit and withdrawal with the same rest hash to different leaves', () => {
      const depositLeaf = hashPulsarActionLeafV2(deposit, Bool(true));
      const withdrawalLeaf = hashPulsarActionLeafV2(withdrawal, Bool(true));
      expect(depositLeaf.toString()).not.toBe(withdrawalLeaf.toString());
    });

    it('fold is order-sensitive', () => {
      const cursor = Field(7);
      const l1 = hashPulsarActionLeafV2(deposit, Bool(true));
      const l2 = hashPulsarActionLeafV2(withdrawal, Bool(false));
      const forward = foldApprovalCursor(foldApprovalCursor(cursor, l1), l2);
      const reversed = foldApprovalCursor(foldApprovalCursor(cursor, l2), l1);
      expect(forward.toString()).not.toBe(reversed.toString());
    });
  });

  describe('provability', () => {
    it('hashPulsarActionLeafV2 + foldApprovalCursor synthesize, prove and verify on witnessed inputs', async () => {
      const analysis = await LeafV2SmokeProgram.analyzeMethods();
      console.log(
        `LeafV2SmokeProgram.hashAndFold rows: ${analysis.hashAndFold.rows}`
      );
      expect(analysis.hashAndFold.rows).toBeGreaterThan(0);

      const { verificationKey } = await LeafV2SmokeProgram.compile();

      const vector = fixture.leaves[1];
      const action = actionFromVector(vector);
      const cursor = Field(fixture.folds[1].fromCursor);
      const { proof } = await LeafV2SmokeProgram.hashAndFold(
        action,
        Bool(vector.approved === '1'),
        cursor
      );

      // fold vector 1 folds exactly this leaf onto this cursor
      expect(proof.publicOutput.toString()).toBe(fixture.folds[1].expected);
      expect(await verify(proof, verificationKey)).toBe(true);
    });
  });
});
