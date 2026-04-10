import { Field, Poseidon, verify, VerificationKey } from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
  Block,
  BlockList,
} from '../SettlementProof';
import { SETTLEMENT_MATRIX_SIZE, VALIDATOR_NUMBER } from '../utils/constants';
import { validatorSet } from './mock';
import {
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
} from '../utils/generateFunctions';
import { TestUtils } from '../utils/testUtils';
import { List } from '../types/common';
import { enableLogs, log } from '../utils/loggers';

describe('SettlementProof tests', () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === '1';
  let merkleList: List;
  let blocks: Block[] = [];
  let settlementPublicInputs: SettlementPublicInputs[] = [];
  let settlementProofs: SettlementProof[] = [];
  let vk: VerificationKey;

  if (process.env.LOGS_ENABLED === '1') {
    enableLogs();
  }

  beforeAll(async () => {
    vk = (
      await MultisigVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    merkleList = List.empty();
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = validatorSet[i];
      merkleList.push(Poseidon.hash(publicKey.toFields()));
    }
  });

  // ---------------------------------------------------------------------------
  // Peripherals
  // ---------------------------------------------------------------------------

  describe('Peripherals', () => {
    it('should create a valid SettlementPublicInputs', () => {
      blocks = TestUtils.GenerateTestBlocks(Field(1), merkleList.hash, Field(1));

      const publicInput = GenerateSettlementPublicInput(
        blocks[0].InitialMerkleListRoot,
        blocks[0].InitialStateRoot,
        blocks[0].InitialBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight
      );

      expect(publicInput.InitialMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.InitialStateRoot).toEqual(Field.from(1));
      expect(publicInput.InitialBlockHeight).toEqual(Field.from(1));
      expect(publicInput.NewMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.NewStateRoot).toEqual(Field.from(SETTLEMENT_MATRIX_SIZE + 1));
      expect(publicInput.NewBlockHeight).toEqual(Field.from(SETTLEMENT_MATRIX_SIZE + 1));

      settlementPublicInputs.push(publicInput);
    });
  });

  // ---------------------------------------------------------------------------
  // verifySignatures — stable validator set (4 epochs → merge)
  // ---------------------------------------------------------------------------

  describe('verifySignatures method', () => {
    it('should verify signatures and create a valid SettlementProof (epoch 1)', async () => {
      const signerMatrix = TestUtils.GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[0],
            signerMatrix,
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof (epoch 1)', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const isValid = await verify(settlementProofs[settlementProofs.length - 1], vk);
      expect(isValid).toBe(true);
    });

    it('should create a valid SettlementProof (epoch 2)', async () => {
      const prev = settlementPublicInputs[settlementPublicInputs.length - 1];
      blocks = TestUtils.GenerateTestBlocks(prev.NewBlockHeight, prev.NewMerkleListRoot, prev.NewStateRoot);

      const publicInput = GenerateSettlementPublicInput(
        prev.NewMerkleListRoot,
        prev.NewStateRoot,
        prev.NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight
      );
      settlementPublicInputs.push(publicInput);

      const signerMatrix = TestUtils.GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            publicInput,
            signerMatrix,
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof (epoch 2)', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const isValid = await verify(settlementProofs[settlementProofs.length - 1], vk);
      expect(isValid).toBe(true);
    });

    it('should create a valid SettlementProof (epoch 3)', async () => {
      const prev = settlementPublicInputs[settlementPublicInputs.length - 1];
      blocks = TestUtils.GenerateTestBlocks(prev.NewBlockHeight, prev.NewMerkleListRoot, prev.NewStateRoot);

      const publicInput = GenerateSettlementPublicInput(
        prev.NewMerkleListRoot,
        prev.NewStateRoot,
        prev.NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight
      );
      settlementPublicInputs.push(publicInput);

      const signerMatrix = TestUtils.GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            publicInput,
            signerMatrix,
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof (epoch 3)', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const isValid = await verify(settlementProofs[settlementProofs.length - 1], vk);
      expect(isValid).toBe(true);
    });

    it('should create a valid SettlementProof (epoch 4)', async () => {
      const prev = settlementPublicInputs[settlementPublicInputs.length - 1];
      blocks = TestUtils.GenerateTestBlocks(prev.NewBlockHeight, prev.NewMerkleListRoot, prev.NewStateRoot);

      const publicInput = GenerateSettlementPublicInput(
        prev.NewMerkleListRoot,
        prev.NewStateRoot,
        prev.NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight
      );
      settlementPublicInputs.push(publicInput);

      const signerMatrix = TestUtils.GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            publicInput,
            signerMatrix,
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should merge the four proofs', async () => {
      const mergedProof = await MergeSettlementProofs(settlementProofs);

      expect(mergedProof.publicInput.NewBlockHeight).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1].NewBlockHeight
      );
      expect(mergedProof.publicInput.NewMerkleListRoot).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1].NewMerkleListRoot
      );
      expect(mergedProof.publicInput.NewStateRoot).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot
      );
      expect(mergedProof.publicInput.InitialMerkleListRoot).toEqual(
        settlementPublicInputs[0].InitialMerkleListRoot
      );
      expect(mergedProof.publicInput.InitialStateRoot).toEqual(
        settlementPublicInputs[0].InitialStateRoot
      );
      expect(mergedProof.publicInput.InitialBlockHeight).toEqual(
        settlementPublicInputs[0].InitialBlockHeight
      );

      settlementProofs = [mergedProof];
    });

    it('should verify the merged proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const isValid = await verify(settlementProofs[0], vk);
      expect(isValid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // verifySignatures — validator rotation within an epoch
  //
  // This test specifically validates the bug fix in SettlementProof.ts where
  // the validator hash check was incorrectly using publicInputs.InitialMerkleListRoot
  // (epoch-wide) instead of pulsarBlocks.list[i].InitialMerkleListRoot (per-block).
  //
  // Scenario:
  //   Block 0: Initial=initialHash → New=newHash  (rotation happens here)
  //   Block 1-7: Initial=newHash   → New=newHash  (new set stable)
  //
  //   Signers for block 0: initial validator set
  //   Signers for blocks 1-7: new validator set
  // ---------------------------------------------------------------------------

  describe('verifySignatures with validator rotation', () => {
    it('should accept signatures when validator set rotates mid-epoch', async () => {
      const initialValidators = validatorSet.slice(0, VALIDATOR_NUMBER);
      const newValidators = validatorSet.slice(VALIDATOR_NUMBER, VALIDATOR_NUMBER * 2);

      const initialMerkleList = TestUtils.CreateValidatorMerkleList(initialValidators);
      const newMerkleList = TestUtils.CreateValidatorMerkleList(newValidators);

      // Rotation happens at block index 0: that block transitions from initial → new set.
      // All subsequent blocks are already on the new set.
      const rotationBlocks = TestUtils.GenerateTestBlocksWithRotation(
        Field(1),
        initialMerkleList.hash,
        newMerkleList.hash,
        0,
        Field(1)
      );

      const publicInput = GenerateSettlementPublicInput(
        rotationBlocks[0].InitialMerkleListRoot,
        rotationBlocks[0].InitialStateRoot,
        rotationBlocks[0].InitialBlockHeight,
        rotationBlocks[rotationBlocks.length - 1].NewMerkleListRoot,
        rotationBlocks[rotationBlocks.length - 1].NewStateRoot,
        rotationBlocks[rotationBlocks.length - 1].NewBlockHeight
      );

      // Each block is signed by whoever was in its InitialMerkleListRoot:
      //   block 0 → initial validators, blocks 1-7 → new validators
      const signersPerBlock = Array.from({ length: SETTLEMENT_MATRIX_SIZE }, (_, i) =>
        i === 0 ? initialValidators : newValidators
      );
      const signerMatrix = TestUtils.GenerateSignaturePubKeyMatrix(rotationBlocks, signersPerBlock);

      const proof = (
        await MultisigVerifierProgram.verifySignatures(
          publicInput,
          signerMatrix,
          BlockList.fromArray(rotationBlocks)
        )
      ).proof;

      expect(proof.publicInput.InitialMerkleListRoot).toEqual(initialMerkleList.hash);
      expect(proof.publicInput.NewMerkleListRoot).toEqual(newMerkleList.hash);
      expect(proof.publicInput.InitialBlockHeight).toEqual(Field(1));
      expect(proof.publicInput.NewBlockHeight).toEqual(Field(SETTLEMENT_MATRIX_SIZE + 1));
    });
  });
});
