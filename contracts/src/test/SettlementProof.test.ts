import { Field, Poseidon, verify, VerificationKey } from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
} from '../SettlementProof';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { ProofGenerators } from '../types/proofGenerators';
import { validatorSet } from './mock';
import {
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
} from '../utils/generateFunctions';
import { GenerateSignaturePubKeyList } from '../utils/testUtils';
import { List } from '../types/common';
import { enableLogs, log } from '../utils/loggers';

describe.skip('SettlementProof tests', () => {
  let proofsEnabled = false;
  let merkleList: List;
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
      const publicInput = GenerateSettlementPublicInput(
        merkleList.hash,
        Field.from(0),
        Field.from(0),
        merkleList.hash,
        Field.from(50),
        Field.from(1),
        [validatorSet[0][1]]
      );
      expect(publicInput.InitialMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.InitialStateRoot).toEqual(Field.from(0));
      expect(publicInput.InitialBlockHeight).toEqual(Field.from(0));
      expect(publicInput.NewMerkleListRoot).toEqual(merkleList.hash);
      expect(publicInput.NewStateRoot).toEqual(Field.from(50));
      expect(publicInput.NewBlockHeight).toEqual(Field.from(1));
      expect(publicInput.ProofGeneratorsList).toEqual(
        ProofGenerators.empty().insertAt(Field.from(0), validatorSet[0][1])
      );

      settlementPublicInputs.push(publicInput);
    });
  });

  describe('verifySignatures method', () => {
    it('should verify signatures and create a valid SettlementProof', async () => {
      const privateInputs = GenerateSignaturePubKeyList(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .hash()
          .toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[0],
            privateInputs,
            validatorSet[0][1]
          )
        ).proof
      );
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });

    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const start = performance.now();
      const isValid = await verify(
        settlementProofs[settlementProofs.length],
        vk
      );
      const end = performance.now();
      log('Verification time:', (end - start) / 1000, 's');
      expect(isValid).toBe(true);
    });

    it('should create another valid SettlementProof', async () => {
      settlementPublicInputs.push(
        GenerateSettlementPublicInput(
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewMerkleListRoot,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewStateRoot,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewBlockHeight,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewMerkleListRoot,
          Field.from(100),
          settlementPublicInputs[
            settlementPublicInputs.length - 1
          ].NewBlockHeight.add(1),
          [validatorSet[1][1]]
        )
      );

      const privateInputs = GenerateSignaturePubKeyList(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .hash()
          .toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[settlementPublicInputs.length - 1],
            privateInputs,
            validatorSet[1][1]
          )
        ).proof
      );
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });

    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const start = performance.now();
      const isValid = await verify(
        settlementProofs[settlementProofs.length - 1],
        vk
      );
      const end = performance.now();
      log('Verification time:', (end - start) / 1000, 's');
      expect(isValid).toBe(true);
    });

    it('should create a third valid SettlementProof', async () => {
      settlementPublicInputs.push(
        GenerateSettlementPublicInput(
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewMerkleListRoot,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewStateRoot,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewBlockHeight,
          settlementPublicInputs[settlementPublicInputs.length - 1]
            .NewMerkleListRoot,
          Field.from(200),
          settlementPublicInputs[
            settlementPublicInputs.length - 1
          ].NewBlockHeight.add(1),
          [validatorSet[2][1]]
        )
      );

      const privateInputs = GenerateSignaturePubKeyList(
        settlementPublicInputs[settlementPublicInputs.length - 1]
          .hash()
          .toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await MultisigVerifierProgram.verifySignatures(
            settlementPublicInputs[settlementPublicInputs.length - 1],
            privateInputs,
            validatorSet[2][1]
          )
        ).proof
      );
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });

    it('should merge the proofs', async () => {
      const start = performance.now();
      const mergedProof = await MergeSettlementProofs(settlementProofs);
      const end = performance.now();
      log('Merge time:', (end - start) / 1000, 's');

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
      const start = performance.now();
      const isValid = await verify(settlementProofs[0], vk);
      const end = performance.now();
      log('Verification time:', (end - start) / 1000, 's');
      expect(isValid).toBe(true);
    });
  });
});
