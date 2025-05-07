import { Field, Poseidon, PrivateKey, PublicKey, Signature } from 'o1js';
import {
  List,
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
  SignaturePublicKeyList,
} from '../SettlementProof';
import {
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
} from './generateFunctions';

export { GenerateSettlementSignatureList, GenerateTestSettlementProof };

function GenerateSettlementSignatureList(
  publicInput: SettlementPublicInputs,
  proofGeneratorsList: Array<[PrivateKey, PublicKey]>
) {
  const signatures = [];

  for (let i = 0; i < proofGeneratorsList.length; i++) {
    signatures.push(
      Signature.create(proofGeneratorsList[i][0], publicInput.hash().toFields())
    );
  }

  return SignaturePublicKeyList.fromArray(
    signatures.map((signature, i) => [signature, proofGeneratorsList[i][1]])
  );
}

async function GenerateTestSettlementProof(
  validatorSet: Array<[PrivateKey, PublicKey]>,
  initialBlockHeight: number,
  newBlockHeight: number
) {
  const settlementPublicInputs: SettlementPublicInputs[] = [];
  const settlementProofs: SettlementProof[] = [];

  const merkleList = List.empty();

  for (let i = 0; i < validatorSet.length; i++) {
    const [, publicKey] = validatorSet[i];
    merkleList.push(Poseidon.hash(publicKey.toFields()));
  }

  for (let i = initialBlockHeight; i < newBlockHeight; i++) {
    const publicInput = GenerateSettlementPublicInput(
      merkleList.hash,
      Field.from(i),
      Field.from(i),
      merkleList.hash,
      Field.from(i + 1),
      Field.from(i + 1),
      [validatorSet[0][1]]
    );
    settlementPublicInputs.push(publicInput);

    const privateInput = GenerateSettlementSignatureList(
      publicInput,
      validatorSet
    );

    const proof = (
      await MultisigVerifierProgram.verifySignatures(
        publicInput,
        privateInput,
        validatorSet[0][1]
      )
    ).proof;

    settlementProofs.push(proof);
  }

  let mergedProof = await MergeSettlementProofs(settlementProofs);

  return mergedProof;
}
