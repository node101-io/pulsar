import { Field, Poseidon, Provable, Struct, ZkProgram } from 'o1js';
import { VALIDATOR_NUMBER } from './utils/constants';
import { List, SignaturePublicKeyList } from './SettlementProof';

export { ReduceVerifierProof, ReduceVerifierProgram, ReducePublicInputs };

class ReducePublicInputs extends Struct({
  stateRoot: Field,
  merkleListRoot: Field,
  blockHeight: Field,
  depositListHash: Field,
  withdrawalListHash: Field,
  rewardListHash: Field,
}) {
  hash() {
    return Poseidon.hash([
      this.stateRoot,
      this.merkleListRoot,
      this.blockHeight,
      this.depositListHash,
      this.withdrawalListHash,
      this.rewardListHash,
    ]);
  }
}

const ReduceVerifierProgram = ZkProgram({
  name: 'reduce-verifier',
  publicInput: ReducePublicInputs,
  publicOutput: undefined,

  methods: {
    verifySignatures: {
      privateInputs: [SignaturePublicKeyList],
      async method(
        publicInputs: ReducePublicInputs,
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
          Field.from((VALIDATOR_NUMBER * 2) / 3),
          'Not enough valid signatures'
        );
      },
    },
  },
});

class ReduceVerifierProof extends ZkProgram.Proof(ReduceVerifierProgram) {}
