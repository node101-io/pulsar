import { Field, Poseidon, Provable, Struct, ZkProgram } from 'o1js';
import { VALIDATOR_NUMBER } from './utils/constants.js';
import { SignaturePublicKeyList } from './types/signaturePubKeyList.js';
import { List } from './types/common.js';

export {
  ValidateReduceProof,
  ValidateReduceProgram,
  ValidateReducePublicInput,
};

class ValidateReducePublicInput extends Struct({
  merkleListRoot: Field,
  depositListHash: Field,
  withdrawalListHash: Field,
}) {
  static default = new this({
    merkleListRoot: Field(0),
    depositListHash: Field(0),
    withdrawalListHash: Field(0),
  });

  hash() {
    return Poseidon.hash([
      this.merkleListRoot,
      this.depositListHash,
      this.withdrawalListHash,
    ]);
  }

  toJSON() {
    return {
      merkleListRoot: this.merkleListRoot.toString(),
      depositListHash: this.depositListHash.toString(),
      withdrawalListHash: this.withdrawalListHash.toString(),
    };
  }
}

const ValidateReduceProgram = ZkProgram({
  name: 'ValidateReduce',
  publicInput: ValidateReducePublicInput,
  publicOutput: undefined,

  methods: {
    verifySignatures: {
      privateInputs: [SignaturePublicKeyList],
      async method(
        publicInputs: ValidateReducePublicInput,
        signaturePublicKeyList: SignaturePublicKeyList
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
          publicInputs.merkleListRoot,
          "Validator MerkleList hash doesn't match"
        );
        counter.assertGreaterThanOrEqual(
          // Field.from((VALIDATOR_NUMBER * 2) / 3),
          Field.from(1),
          'Not enough valid signatures'
        );
      },
    },
  },
});

class ValidateReduceProof extends ZkProgram.Proof(ValidateReduceProgram) {}
