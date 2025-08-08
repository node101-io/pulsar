import {
  Field,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Struct,
  ZkProgram,
} from 'o1js';
import { ProofGenerators } from './types/proofGenerators.js';
import {
  AGGREGATE_THRESHOLD,
  SETTLEMENT_MATRIX_SIZE,
  VALIDATOR_NUMBER,
} from './utils/constants.js';
import { SignaturePublicKeyMatrix } from './types/signaturePubKeyList.js';
import { List } from './types/common.js';

export {
  SettlementProof,
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementPublicOutputs,
  Block,
  BlockList,
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

class Block extends Struct({
  InitialMerkleListRoot: Field,
  InitialStateRoot: Field,
  InitialBlockHeight: Field,

  NewMerkleListRoot: Field,
  NewStateRoot: Field,
  NewBlockHeight: Field,
}) {
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

  toJSON() {
    return {
      InitialMerkleListRoot: this.InitialMerkleListRoot.toString(),
      InitialStateRoot: this.InitialStateRoot.toString(),
      InitialBlockHeight: this.InitialBlockHeight.toString(),
      NewMerkleListRoot: this.NewMerkleListRoot.toString(),
      NewStateRoot: this.NewStateRoot.toString(),
      NewBlockHeight: this.NewBlockHeight.toString(),
    };
  }
}

class BlockList extends Struct({
  list: Provable.Array(Block, SETTLEMENT_MATRIX_SIZE),
}) {
  static fromArray(arr: Block[]): BlockList {
    return new BlockList({
      list: arr,
    });
  }

  toJSON() {
    return this.list.map((block) => block.toJSON());
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
      privateInputs: [SignaturePublicKeyMatrix, PublicKey, BlockList],
      async method(
        publicInputs: SettlementPublicInputs,
        signaturePublicKeyMatrix: SignaturePublicKeyMatrix,
        proofGenerator: PublicKey,
        pulsarBlocks: BlockList
      ) {
        pulsarBlocks.list[0].InitialMerkleListRoot.assertEquals(
          publicInputs.InitialMerkleListRoot,
          'Initial MerkleList root mismatch'
        );
        pulsarBlocks.list[0].InitialStateRoot.assertEquals(
          publicInputs.InitialStateRoot,
          'Initial state root mismatch'
        );
        pulsarBlocks.list[0].InitialBlockHeight.assertEquals(
          publicInputs.InitialBlockHeight,
          'Initial block height mismatch'
        );

        for (let i = 1; i < SETTLEMENT_MATRIX_SIZE; i++) {
          pulsarBlocks.list[i].InitialMerkleListRoot.assertEquals(
            pulsarBlocks.list[i - 1].NewMerkleListRoot,
            'MerkleList root mismatch between pulsar blocks'
          );

          pulsarBlocks.list[i].InitialStateRoot.assertEquals(
            pulsarBlocks.list[i - 1].NewStateRoot,
            'State root mismatch between pulsar blocks'
          );

          pulsarBlocks.list[i].InitialBlockHeight.assertEquals(
            pulsarBlocks.list[i - 1].NewBlockHeight,
            'Block height mismatch between pulsar blocks'
          );
        }
        pulsarBlocks.list[
          SETTLEMENT_MATRIX_SIZE - 1
        ].NewMerkleListRoot.assertEquals(
          publicInputs.NewMerkleListRoot,
          'Final MerkleList root mismatch'
        );
        pulsarBlocks.list[SETTLEMENT_MATRIX_SIZE - 1].NewStateRoot.assertEquals(
          publicInputs.NewStateRoot,
          'Final state root mismatch'
        );
        pulsarBlocks.list[
          SETTLEMENT_MATRIX_SIZE - 1
        ].NewBlockHeight.assertEquals(
          publicInputs.NewBlockHeight,
          'Final block height mismatch'
        );

        for (let i = 0; i < SETTLEMENT_MATRIX_SIZE; i++) {
          pulsarBlocks.list[i].NewBlockHeight.assertEquals(
            pulsarBlocks.list[i].InitialBlockHeight.add(1),
            'Skipped block'
          );

          let counter = Field.from(0);
          let list = List.empty();
          const signatureMessage = pulsarBlocks.list[i].hash().toFields();

          for (let j = 0; j < VALIDATOR_NUMBER; j++) {
            const { signature, publicKey } =
              signaturePublicKeyMatrix.matrix[i].list[j];
            const isValid = signature.verify(publicKey, signatureMessage);
            counter = Provable.if(isValid, counter.add(1), counter);

            list.push(Poseidon.hash(publicKey.toFields()));
          }

          list.hash.assertEquals(
            publicInputs.InitialMerkleListRoot,
            "Validator MerkleList hash doesn't match"
          );
          counter.assertGreaterThanOrEqual(
            // Field.from((VALIDATOR_NUMBER * 2) / 3),
            Field(VALIDATOR_NUMBER),
            'Not enough valid signatures'
          );
        }

        let proofGeneratorsList = ProofGenerators.empty().insertAt(
          Field(0),
          proofGenerator
        );
        publicInputs.ProofGeneratorsList.assertEquals(proofGeneratorsList);

        return {
          publicOutput: new SettlementPublicOutputs({
            numberOfSettlementProofs: Field(SETTLEMENT_MATRIX_SIZE),
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
            previousProof.publicOutput.numberOfSettlementProofs.div(
              Field(SETTLEMENT_MATRIX_SIZE)
            ),
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
