import {
  Field,
  PrivateKey,
  PublicKey,
  Poseidon,
  Signature,
  Provable,
  verify,
  VerificationKey,
} from 'o1js';
import {
  List,
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
  SignaturePublicKeyList,
} from '../SettlementProof';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { ProofGenerators } from '../utils/proofGenerators';

describe('SettlementProof tests', () => {
  const logsEnabled = true;
  let proofsEnabled = false;
  let validators: Array<[PrivateKey, PublicKey]>;
  let merkleList: List;
  let signatures: Array<Signature>;
  let previousSettlementPublicInputs: SettlementPublicInputs;
  let previousSettlementProof: SettlementProof;
  let afterPublicInputs: SettlementPublicInputs;
  let afterSettlementProof: SettlementProof;
  let mergePublicInputs: SettlementPublicInputs;
  let mergeSettlementProof: SettlementProof;
  let vk: VerificationKey;

  // Helper functions
  function log(...args: any[]) {
    if (logsEnabled) {
      console.log(...args);
    }
  }

  beforeAll(async () => {
    // log(await MultisigVerifierProgram.analyzeMethods());
    vk = (
      await MultisigVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    validators = [];
    signatures = [];
    merkleList = List.empty();

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const privateKey = PrivateKey.random();
      const publicKey = privateKey.toPublicKey();
      validators.push([privateKey, publicKey]);
    }

    validators.sort((a, b) => {
      const aHash = Poseidon.hash(a[1].toFields());
      const bHash = Poseidon.hash(b[1].toFields());
      return aHash.toBigInt() < bHash.toBigInt() ? -1 : 1;
    });

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = validators[i];
      merkleList.push(Poseidon.hash(publicKey.toFields()));
    }
  });

  describe('Peripheral functions', () => {
    it('should create a valid SettlementPublicInputs', () => {
      const InitialMerkleListRoot = Field.random();
      const InitialStateRoot = Field.random();
      const InitialBlockHeight = Field.random();
      const NewMerkleListRoot = Field.random();
      const NewStateRoot = Field.random();
      const NewBlockHeight = Field.random();
      const ProofGeneratorsList = ProofGenerators.empty();

      const settlementPublicInputs = new SettlementPublicInputs({
        InitialMerkleListRoot,
        InitialStateRoot,
        InitialBlockHeight,
        NewMerkleListRoot,
        NewStateRoot,
        NewBlockHeight,
        ProofGeneratorsList,
      });
      expect(settlementPublicInputs.InitialMerkleListRoot).toEqual(
        InitialMerkleListRoot
      );
      expect(settlementPublicInputs.InitialStateRoot).toEqual(InitialStateRoot);
      expect(settlementPublicInputs.InitialBlockHeight).toEqual(
        InitialBlockHeight
      );
      expect(settlementPublicInputs.NewMerkleListRoot).toEqual(
        NewMerkleListRoot
      );
      expect(settlementPublicInputs.NewStateRoot).toEqual(NewStateRoot);
      expect(settlementPublicInputs.NewBlockHeight).toEqual(NewBlockHeight);
      expect(settlementPublicInputs.ProofGeneratorsList).toEqual(
        ProofGeneratorsList
      );
    });
  });

  describe('verifySignatures method', () => {
    it('should verify signatures and create a valid SettlementProof', async () => {
      previousSettlementPublicInputs = new SettlementPublicInputs({
        InitialMerkleListRoot: merkleList.hash,
        InitialStateRoot: Field.from(0),
        InitialBlockHeight: Field.from(0),
        NewBlockHeight: Field.from(1),
        NewMerkleListRoot: merkleList.hash,
        NewStateRoot: Field.random(),
        ProofGeneratorsList: Provable.witness(ProofGenerators, () =>
          ProofGenerators.empty().insertAt(Field(0), validators[0][1])
        ),
      });

      for (let i = 0; i < VALIDATOR_NUMBER; i++) {
        const [privateKey] = validators[i];
        const signature = Signature.create(
          privateKey,
          previousSettlementPublicInputs.hash().toFields()
        );
        signatures.push(signature);
      }

      const privateInputs = SignaturePublicKeyList.fromArray(
        signatures.map((signature, i) => [signature, validators[i][1]])
      );

      const start = performance.now();
      previousSettlementProof = (
        await MultisigVerifierProgram.verifySignatures(
          previousSettlementPublicInputs,
          privateInputs,
          validators[0][1]
        )
      ).proof;
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });
    it('should verify the generated proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const start = performance.now();
      const isValid = await verify(previousSettlementProof, vk);
      const end = performance.now();
      log('Verification time:', (end - start) / 1000, 's');
      expect(isValid).toBe(true);
    });

    it('should create another valid SettlementProof', async () => {
      signatures = [];

      afterPublicInputs = new SettlementPublicInputs({
        InitialMerkleListRoot: merkleList.hash,
        InitialStateRoot: previousSettlementPublicInputs.NewStateRoot,
        InitialBlockHeight: previousSettlementPublicInputs.NewBlockHeight,
        NewBlockHeight: Field.from(2),
        NewMerkleListRoot: merkleList.hash,
        NewStateRoot: Field.random(),
        ProofGeneratorsList: ProofGenerators.empty().insertAt(
          Field(0),
          validators[1][1]
        ),
      });

      for (let i = 0; i < VALIDATOR_NUMBER; i++) {
        const [privateKey] = validators[i];
        const signature = Signature.create(
          privateKey,
          afterPublicInputs.hash().toFields()
        );
        signatures.push(signature);
      }

      const privateInputs = SignaturePublicKeyList.fromArray(
        signatures.map((signature, i) => [signature, validators[i][1]])
      );

      const start = performance.now();
      afterSettlementProof = (
        await MultisigVerifierProgram.verifySignatures(
          afterPublicInputs,
          privateInputs,
          validators[1][1]
        )
      ).proof;
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });

    it('should merge proofs', async () => {
      mergePublicInputs = new SettlementPublicInputs({
        InitialMerkleListRoot:
          previousSettlementPublicInputs.InitialMerkleListRoot,
        InitialStateRoot: previousSettlementPublicInputs.InitialStateRoot,
        InitialBlockHeight: previousSettlementPublicInputs.InitialBlockHeight,
        NewBlockHeight: afterPublicInputs.NewBlockHeight,
        NewMerkleListRoot: afterPublicInputs.NewMerkleListRoot,
        NewStateRoot: afterPublicInputs.NewStateRoot,
        ProofGeneratorsList: ProofGenerators.empty()
          .insertAt(Field(0), validators[0][1])
          .insertAt(Field(1), validators[1][1]),
      });

      const start = performance.now();
      mergeSettlementProof = (
        await MultisigVerifierProgram.mergeProofs(
          mergePublicInputs,
          previousSettlementProof,
          afterSettlementProof
        )
      ).proof;
      const end = performance.now();
      log('Proof generation time:', (end - start) / 1000, 's');
    });
    it('should verify the merged proof', async () => {
      if (!proofsEnabled) {
        log('Skipping proof verification');
        return;
      }
      const start = performance.now();
      const isValid = await verify(mergeSettlementProof, vk);
      const end = performance.now();
      log('Verification time:', (end - start) / 1000, 's');
      expect(isValid).toBe(true);
    });
  });
});
