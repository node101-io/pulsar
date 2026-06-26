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
  actionListHash: Field,
}) {
  static default = new this({
    merkleListRoot: Field(0),
    actionListHash: Field(0),
  });

  hash() {
    return Poseidon.hash([this.merkleListRoot, this.actionListHash]);
  }

  static fromJSON(json: { merkleListRoot: string; actionListHash: string }) {
    return new ValidateReducePublicInput({
      merkleListRoot: Field(json.merkleListRoot),
      actionListHash: Field(json.actionListHash),
    });
  }

  toJSON() {
    return {
      merkleListRoot: this.merkleListRoot.toString(),
      actionListHash: this.actionListHash.toString(),
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
        let accumulatedPower = Field.from(0);
        let totalPower = Field.from(0);
        let list = List.empty();
        const signatureMessage = publicInputs.hash().toFields();

        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          const { signature, publicKey, power } =
            signaturePublicKeyList.list[i];
          const isValid = signature.verify(publicKey, signatureMessage);
          accumulatedPower = Provable.if(
            isValid,
            accumulatedPower.add(power),
            accumulatedPower
          );
          totalPower = totalPower.add(power);

          list.push(
            Poseidon.hashWithPrefix('pulsar-validator', [
              ...publicKey.toFields(),
              power,
            ])
          );
        }

        list.hash.assertEquals(
          publicInputs.merkleListRoot,
          "Validator MerkleList hash doesn't match"
        );
        // 2/3 voting-power quorum: signed power / total power >= 2/3
        accumulatedPower
          .mul(3)
          .assertGreaterThanOrEqual(
            totalPower.mul(2),
            'Not enough signed voting power (< 2/3)'
          );
      },
    },
  },
});

class ValidateReduceProof extends ZkProgram.Proof(ValidateReduceProgram) {}
