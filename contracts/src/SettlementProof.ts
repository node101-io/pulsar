import {
  Field,
  MerkleList,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  Struct,
  ZkProgram,
} from 'o1js';
import { ProofGenerators } from './utils/proofGenerators';
import { AGGREGATE_THRESHOLD, VALIDATOR_NUMBER } from './utils/constants';

export {
  SettlementProof,
  MultisigVerifierProgram,
  List,
  SignaturePublicKeyList,
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

class SignaturePublicKey extends Struct({
  signature: Signature,
  publicKey: PublicKey,
}) {}

class SignaturePublicKeyList extends Struct({
  list: Provable.Array(SignaturePublicKey, VALIDATOR_NUMBER),
}) {
  static fromArray(arr: Array<[Signature, PublicKey]>): SignaturePublicKeyList {
    return new SignaturePublicKeyList({
      list: arr.map(
        ([signature, publicKey]) =>
          new SignaturePublicKey({ signature, publicKey })
      ),
    });
  }
}

const emptyHash = Poseidon.hash([Field(0)]);
const nextHash = (hash: Field, value: Field) => Poseidon.hash([hash, value]);
class List extends MerkleList.create(Field, nextHash, emptyHash) {}

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

        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          const { signature, publicKey } = signaturePublicKeyList.list[i];

          const isValid = signature.verify(
            publicKey,
            publicInputs.hash().toFields()
          );
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
          Poseidon.hash(proofGenerator.toFields())
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

        let numberOfSettlementProofs =
          previousProof.publicOutput.numberOfSettlementProofs.add(
            afterProof.publicOutput.numberOfSettlementProofs
          );

        numberOfSettlementProofs.assertLessThanOrEqual(
          Field(AGGREGATE_THRESHOLD),
          'Number of settlement proofs exceeds limit'
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
