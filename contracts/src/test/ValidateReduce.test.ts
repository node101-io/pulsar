import { Field, Poseidon, verify, VerificationKey } from 'o1js';
import {
  ValidateReducePublicInput,
  ValidateReduceProof,
  ValidateReduceProgram,
} from '../ValidateReduce';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { validatorSet } from './mock';
import { TestUtils } from '../utils/testUtils';
import { List } from '../types/common';
import { enableLogs, log } from '../utils/loggers';

describe('ValidateReduceProof tests', () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === '1';
  let merkleList: List;
  let publicInputs: ValidateReducePublicInput[] = [];
  let settlementProofs: ValidateReduceProof[] = [];
  let vk: VerificationKey;
  if (process.env.LOGS_ENABLED === '1') {
    enableLogs();
  }

  beforeAll(async () => {
    vk = (
      await ValidateReduceProgram.compile({
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
    it('should create a valid ValidateReducePublicInput', () => {
      publicInputs.push(
        new ValidateReducePublicInput({
          stateRoot: Field(0),
          merkleListRoot: merkleList.hash,
          blockHeight: Field(0),
          depositListHash: Field(0),
          withdrawalListHash: Field(0),
          rewardListHash: Field(0),
        })
      );

      expect(publicInputs[0].hash()).toEqual(
        Poseidon.hash([
          publicInputs[0].stateRoot,
          publicInputs[0].merkleListRoot,
          publicInputs[0].blockHeight,
          publicInputs[0].depositListHash,
          publicInputs[0].withdrawalListHash,
          publicInputs[0].rewardListHash,
        ])
      );
    });
  });

  describe('verifySignatures method', () => {
    it('should verify signatures and create a valid ValidateReduceProof', async () => {
      const privateInputs = TestUtils.GenerateSignaturePubKeyList(
        publicInputs[publicInputs.length - 1].hash().toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await ValidateReduceProgram.verifySignatures(
            publicInputs[0],
            privateInputs
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

    it('should create another valid ValidateReduceProof', async () => {
      publicInputs.push(
        new ValidateReducePublicInput({
          stateRoot: Field(1),
          merkleListRoot: merkleList.hash,
          blockHeight: Field(1),
          depositListHash: Field(1),
          withdrawalListHash: Field(1),
          rewardListHash: Field(1),
        })
      );

      const privateInputs = TestUtils.GenerateSignaturePubKeyList(
        publicInputs[publicInputs.length - 1].hash().toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await ValidateReduceProgram.verifySignatures(
            publicInputs[publicInputs.length - 1],
            privateInputs
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

    it('should create a third valid ValidateReduceProof', async () => {
      publicInputs.push(
        new ValidateReducePublicInput({
          stateRoot: Field(2),
          merkleListRoot: merkleList.hash,
          blockHeight: Field(2),
          depositListHash: Field(2),
          withdrawalListHash: Field(2),
          rewardListHash: Field(2),
        })
      );

      const privateInputs = TestUtils.GenerateSignaturePubKeyList(
        publicInputs[publicInputs.length - 1].hash().toFields(),
        validatorSet
      );

      const start = performance.now();
      settlementProofs.push(
        (
          await ValidateReduceProgram.verifySignatures(
            publicInputs[publicInputs.length - 1],
            privateInputs
          )
        ).proof
      );
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });
  });
});
