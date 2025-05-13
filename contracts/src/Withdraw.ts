import { Field, Poseidon, Provable, PublicKey, Struct, ZkProgram } from 'o1js';
import { VALIDATOR_NUMBER } from './utils/constants';
import { List, SignaturePublicKeyList } from './types';

export { WithdrawProgram, WithdrawalProof };

class WithdrawPublicInputs extends Struct({
  InitialMerkleListRoot: Field,
  NewMerkleListRoot: Field,
  account: PublicKey,
  amount: Field,
}) {}

const WithdrawProgram = ZkProgram({
  name: 'withdraw',
  publicInput: WithdrawPublicInputs,
  publicOutput: undefined,
  methods: {
    proveWithdraw: {
      privateInputs: [SignaturePublicKeyList, SignaturePublicKeyList],
      async method(
        publicInputs: WithdrawPublicInputs,
        signatureList1: SignaturePublicKeyList,
        signatureList2: SignaturePublicKeyList
      ) {
        let counter1 = Field.from(0);
        let counter2 = Field.from(0);

        let list1 = List.empty();
        let list2 = List.empty();

        const signatureMessage = Poseidon.hash([
          ...publicInputs.account.toFields(),
          publicInputs.amount,
          publicInputs.InitialMerkleListRoot,
        ]).toFields();

        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          const { signature: signature1, publicKey: publicKey1 } =
            signatureList1.list[i];
          const { signature: signature2, publicKey: publicKey2 } =
            signatureList2.list[i];

          const isValid1 = signature1.verify(publicKey1, signatureMessage);
          const isValid2 = signature2.verify(publicKey2, signatureMessage);

          counter1 = Provable.if(isValid1, counter1.add(1), counter1);
          counter2 = Provable.if(isValid2, counter2.add(1), counter2);

          list1.push(Poseidon.hash(publicKey1.toFields()));
          list2.push(Poseidon.hash(publicKey2.toFields()));
        }

        list1.hash.assertEquals(
          publicInputs.InitialMerkleListRoot,
          "Initial Validator MerkleList hash doesn't match"
        );

        list2.hash.assertEquals(
          publicInputs.NewMerkleListRoot,
          "New Validator MerkleList hash doesn't match"
        );

        counter1.assertGreaterThanOrEqual(
          Field.from((VALIDATOR_NUMBER * 2) / 3),
          'Not enough valid signatures'
        );

        counter2.assertGreaterThanOrEqual(
          Field.from((VALIDATOR_NUMBER * 2) / 3),
          'Not enough valid signatures'
        );
      },
    },
  },
});

class WithdrawalProof extends ZkProgram.Proof(WithdrawProgram) {}
