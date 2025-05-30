import {
  Field,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Struct,
  ZkProgram,
} from 'o1js';
import { ProofGenerators } from './types/proofGenerators';
import { AGGREGATE_THRESHOLD, VALIDATOR_NUMBER } from './utils/constants';
import { SignaturePublicKeyList } from './types/signaturePubKeyList';
import { List } from './types/common';

export {
  SettlementProof,
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementPublicOutputs,
};

class SettlementPublicInputs extends Struct({
  InitialMerkleListRoot: Field,
  InitialStateRoot: Field,
  InitialBlockHeight: Field,

  NewMerkleListRoot: Field,
  NewStateRoot: Field,
  NewBlockHeight: Field,

  ProofGeneratorsList: ProofGenerators,
}) {
  static default = new this({
    InitialMerkleListRoot: Field(0),
    InitialStateRoot: Field(0),
    InitialBlockHeight: Field(0),
    NewMerkleListRoot: Field(0),
    NewStateRoot: Field(0),
    NewBlockHeight: Field(0),
    ProofGeneratorsList: ProofGenerators.empty(),
  });

  isEmpty() {
    return this.InitialMerkleListRoot.equals(Field(0)).and(
      this.InitialStateRoot.equals(Field(0)).and(
        this.InitialBlockHeight.equals(Field.from(0)).and(
          this.NewBlockHeight.equals(Field(0)).and(
            this.NewMerkleListRoot.equals(Field(0)).and(
              this.NewStateRoot.equals(Field(0)).and(
                this.ProofGeneratorsList.isEmpty()
              )
            )
          )
        )
      )
    );
  }

  hash() {
    return Poseidon.hash([
      this.InitialMerkleListRoot,
      this.InitialStateRoot,
      this.InitialBlockHeight,
      this.NewMerkleListRoot,
      this.NewStateRoot,
      this.NewBlockHeight,
    ]);
  }

  actionHash() {
    return Poseidon.hash([
      Field(1),
      this.InitialStateRoot,
      this.NewStateRoot,
      this.InitialMerkleListRoot,
      this.NewMerkleListRoot,
      this.InitialBlockHeight,
      this.NewBlockHeight,
      Poseidon.hash(this.ProofGeneratorsList.toFields()),
    ]);
  }

  toJSON() {
    return {
      InitialMerkleListRoot: this.InitialMerkleListRoot.toString(),
      InitialStateRoot: this.InitialStateRoot.toString(),
      InitialBlockHeight: this.InitialBlockHeight.toString(),
      NewMerkleListRoot: this.NewMerkleListRoot.toString(),
      NewStateRoot: this.NewStateRoot.toString(),
      NewBlockHeight: this.NewBlockHeight.toString(),
      ProofGeneratorsList: this.ProofGeneratorsList.toJSON(),
    };
  }
}

// In case we need to add more fields in the future
// to the public output, we can do it here
class SettlementPublicOutputs extends Struct({
  numberOfSettlementProofs: Field,
}) {
  static default = new this({
    numberOfSettlementProofs: Field(0),
  });
}

const MultisigVerifierProgram = ZkProgram({
  name: 'state-settlement-verifier',
  publicInput: SettlementPublicInputs,
  publicOutput: SettlementPublicOutputs,

  methods: {
    verifySignatures: {
      privateInputs: [SignaturePublicKeyList, PublicKey],
      async method(
        publicInputs: SettlementPublicInputs,
        signaturePublicKeyList: SignaturePublicKeyList,
        proofGenerator: PublicKey
      ) {
        let counter = Field.from(0);
        let list = List.empty();
        const signatureMessage = publicInputs.hash().toFields();

        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          const { signature, publicKey } = signaturePublicKeyList.list[i];
          const isValid = signature.verify(publicKey, signatureMessage);
          counter = Provable.if(isValid, counter.add(1), counter);

          list.push(Poseidon.hash(publicKey.toFields()));
        }

        list.hash.assertEquals(
          publicInputs.InitialMerkleListRoot,
          "Validator MerkleList hash doesn't match"
        );
        counter.assertGreaterThanOrEqual(
          Field.from((VALIDATOR_NUMBER * 2) / 3),
          'Not enough valid signatures'
        );

        let proofGeneratorsList = ProofGenerators.empty().insertAt(
          Field(0),
          proofGenerator
        );
        publicInputs.ProofGeneratorsList.assertEquals(proofGeneratorsList);

        return {
          publicOutput: new SettlementPublicOutputs({
            numberOfSettlementProofs: Field(1),
          }),
        };
      },
    },

    mergeProofs: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        publicInputs: SettlementPublicInputs,
        previousProof: SelfProof<
          SettlementPublicInputs,
          SettlementPublicOutputs
        >,
        afterProof: SelfProof<SettlementPublicInputs, SettlementPublicOutputs>
      ) {
        previousProof.verify();
        afterProof.verify();

        let numberOfSettlementProofs =
          previousProof.publicOutput.numberOfSettlementProofs.add(
            afterProof.publicOutput.numberOfSettlementProofs
          );

        numberOfSettlementProofs.assertLessThanOrEqual(
          Field(AGGREGATE_THRESHOLD),
          'Number of settlement proofs exceeds limit'
        );

        const { publicInput: previousPublicInput } = previousProof;
        const { publicInput: afterPublicInput } = afterProof;

        previousPublicInput.NewBlockHeight.assertEquals(
          afterPublicInput.InitialBlockHeight,
          'Block height mismatch between proofs'
        );

        previousPublicInput.NewMerkleListRoot.assertEquals(
          afterPublicInput.InitialMerkleListRoot,
          'MerkleList root mismatch between proofs'
        );

        previousPublicInput.NewStateRoot.assertEquals(
          afterPublicInput.InitialStateRoot,
          'State root mismatch between proofs'
        );

        publicInputs.InitialMerkleListRoot.assertEquals(
          previousPublicInput.InitialMerkleListRoot,
          'Initial MerkleList root mismatch'
        );

        publicInputs.InitialStateRoot.assertEquals(
          previousPublicInput.InitialStateRoot,
          'Initial state root mismatch'
        );

        publicInputs.InitialBlockHeight.assertEquals(
          previousPublicInput.InitialBlockHeight,
          'Initial block height mismatch'
        );

        publicInputs.NewMerkleListRoot.assertEquals(
          afterPublicInput.NewMerkleListRoot,
          'New MerkleList root mismatch'
        );

        publicInputs.NewStateRoot.assertEquals(
          afterPublicInput.NewStateRoot,
          'New state root mismatch'
        );

        publicInputs.NewBlockHeight.assertEquals(
          afterPublicInput.NewBlockHeight,
          'New block height mismatch'
        );

        publicInputs.ProofGeneratorsList.assertEquals(
          previousPublicInput.ProofGeneratorsList.appendList(
            previousProof.publicOutput.numberOfSettlementProofs,
            afterPublicInput.ProofGeneratorsList
          )
        );

        return {
          publicOutput: new SettlementPublicOutputs({
            numberOfSettlementProofs,
          }),
        };
      },
    },
  },
});

class SettlementProof extends ZkProgram.Proof(MultisigVerifierProgram) {}
