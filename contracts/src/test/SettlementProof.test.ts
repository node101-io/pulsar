import { Field, Poseidon, verify, VerificationKey } from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
  Block,
  BlockList,
} from '../SettlementProof';
import { SETTLEMENT_MATRIX_SIZE, VALIDATOR_NUMBER } from '../utils/constants';
import { ProofGenerators } from '../types/proofGenerators';
import { validatorSet } from './mock';
import {
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
} from '../utils/generateFunctions';
import {
  GenerateSignaturePubKeyMatrix,
  GenerateTestBlocks,
} from '../utils/testUtils';
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

  describe('Peripherals', () => {
    it('should create a valid SettlementPublicInputs', () => {
      blocks = GenerateTestBlocks(Field(1), merkleList.hash, Field(1));

      const publicInput = GenerateSettlementPublicInput(
        blocks[0].InitialMerkleListRoot,
        blocks[0].InitialStateRoot,
        blocks[0].InitialBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight,
        [validatorSet[0][1]]
      );

      expect(publicInput.InitialMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.InitialStateRoot).toEqual(Field.from(1));
      expect(publicInput.InitialBlockHeight).toEqual(Field.from(1));
      expect(publicInput.NewMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.NewStateRoot).toEqual(
        Field.from(SETTLEMENT_MATRIX_SIZE + 1)
      );
      expect(publicInput.NewBlockHeight).toEqual(
        Field.from(SETTLEMENT_MATRIX_SIZE + 1)
      );
      expect(publicInput.ProofGeneratorsList).toEqual(
        ProofGenerators.empty().insertAt(Field.from(0), validatorSet[0][1])
      );

      settlementPublicInputs.push(publicInput);
    });
  });

  describe('verifySignatures method', () => {
    it('should verify signatures and create a valid SettlementProof', async () => {
      const signerMatrix = GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[0],
            signerMatrix,
            validatorSet[0][1],
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }

      const isValid = await verify(
        settlementProofs[settlementProofs.length],
        vk
      );

      expect(isValid).toBe(true);
    });

    it('should create another valid SettlementProof', async () => {
      blocks = GenerateTestBlocks(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot
      );

      const publicInput = GenerateSettlementPublicInput(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight,
        [validatorSet[1][1]]
      );

      settlementPublicInputs.push(publicInput);

      const signerMatrix = GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[settlementPublicInputs.length - 1],
            signerMatrix,
            validatorSet[1][1],
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }

      const isValid = await verify(
        settlementProofs[settlementProofs.length - 1],
        vk
      );

      expect(isValid).toBe(true);
    });

    it('should create a third valid SettlementProof', async () => {
      blocks = GenerateTestBlocks(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot
      );

      const publicInput = GenerateSettlementPublicInput(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight,
        [validatorSet[2][1]]
      );

      settlementPublicInputs.push(publicInput);

      const signerMatrix = GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[settlementPublicInputs.length - 1],
            signerMatrix,
            validatorSet[2][1],
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }

      const isValid = await verify(
        settlementProofs[settlementProofs.length - 1],
        vk
      );

      expect(isValid).toBe(true);
    });

    it('should create a fourth valid SettlementProof', async () => {
      blocks = GenerateTestBlocks(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot
      );

      const publicInput = GenerateSettlementPublicInput(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot,
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight,
        [validatorSet[3][1]]
      );

      settlementPublicInputs.push(publicInput);

      const signerMatrix = GenerateSignaturePubKeyMatrix(
        blocks,
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[settlementPublicInputs.length - 1],
            signerMatrix,
            validatorSet[3][1],
            BlockList.fromArray(blocks)
          )
        ).proof
      );
    });

    it('should merge the proofs', async () => {
      const mergedProof = await MergeSettlementProofs(settlementProofs);

      expect(mergedProof.publicInput.NewBlockHeight).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1].NewBlockHeight
      );
      expect(mergedProof.publicInput.NewMerkleListRoot).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .NewMerkleListRoot
      );
      expect(mergedProof.publicInput.NewStateRoot).toEqual(
        settlementPublicInputs[settlementPublicInputs.length - 1].NewStateRoot
      );
      expect(mergedProof.publicInput.ProofGeneratorsList).toEqual(
        ProofGenerators.empty()
          .insertAt(Field.from(0), validatorSet[0][1])
          .insertAt(Field.from(1), validatorSet[1][1])
          .insertAt(Field.from(2), validatorSet[2][1])
          .insertAt(Field.from(3), validatorSet[3][1])
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
});
