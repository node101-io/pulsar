import {
  Field,
  Poseidon,
  PrivateKey,
  PublicKey,
  Signature,
} from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
} from '../SettlementProof';
import {
  GenerateValidateReduceProof,
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
} from './generateFunctions';
import { SettlementContract } from '../SettlementContract';
import { ValidateReducePublicInput } from '../ValidateReduce';
import { SignaturePublicKeyList } from '../types/signaturePubKeyList';
import { List } from '../types/common';
import { PulsarAction } from '../types/PulsarAction';
import { CalculateMask } from './reduceWitness';
import { log } from './loggers.js';

export {
  GenerateSignaturePubKeyList,
  GenerateReducerSignatureList,
  GenerateTestSettlementProof,
  MockReducerVerifierProof,
};

function GenerateSignaturePubKeyList(
  signatureMessage: Field[],
  signerSet: Array<[PrivateKey, PublicKey]>
) {
  const signatures = [];

  for (let i = 0; i < signerSet.length; i++) {
    signatures.push(Signature.create(signerSet[i][0], signatureMessage));
  }

  return SignaturePublicKeyList.fromArray(
    signatures.map((signature, i) => [signature, signerSet[i][1]])
  );
}

function GenerateReducerSignatureList(
  publicInput: ValidateReducePublicInput,
  proofGeneratorsList: Array<[PrivateKey, PublicKey]>
) {
  const signatures = [];

  const message = publicInput.hash().toFields();

  for (let i = 0; i < proofGeneratorsList.length; i++) {
    signatures.push(Signature.create(proofGeneratorsList[i][0], message));
  }

  return SignaturePublicKeyList.fromArray(
    signatures.map((signature, i) => [signature, proofGeneratorsList[i][1]])
  );
}

function CreateValidatorMerkleList(
  validatorSet: Array<[PrivateKey, PublicKey]>
) {
  const merkleList = List.empty();

  for (let i = 0; i < validatorSet.length; i++) {
    const [, publicKey] = validatorSet[i];
    merkleList.push(Poseidon.hash(publicKey.toFields()));
  }

  return merkleList;
}

async function GenerateTestSettlementProof(
  validatorSet: Array<[PrivateKey, PublicKey]>,
  initialBlockHeight: number,
  newBlockHeight: number,
  initialStateRoot: number = initialBlockHeight,
  newStateRoot: number = newBlockHeight
) {
  const settlementPublicInputs: SettlementPublicInputs[] = [];
  const settlementProofs: SettlementProof[] = [];

  const merkleList = CreateValidatorMerkleList(validatorSet);

  log(validatorSet[0][1].toBase58());
  for (let i = initialBlockHeight; i < newBlockHeight; i++) {
    const publicInput = GenerateSettlementPublicInput(
      merkleList.hash,
      Field.from(
        i == initialBlockHeight
          ? initialStateRoot
          : settlementPublicInputs[i - initialBlockHeight - 1].NewStateRoot
      ),
      Field.from(i),
      merkleList.hash,
      Field.from(i == newBlockHeight - 1 ? newStateRoot : Field.random()),
      Field.from(i + 1),
      [validatorSet[0][1]]
    );
    settlementPublicInputs.push(publicInput);

    const privateInput = GenerateSignaturePubKeyList(
      publicInput.hash().toFields(),
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

  log(
    'Settlement Public Inputs:',
    settlementPublicInputs.map((input) => input.toJSON())
  );

  let mergedProof = await MergeSettlementProofs(settlementProofs);

  return mergedProof;
}

async function MockReducerVerifierProof(
  contractInstance: SettlementContract,
  batchActions: Array<PulsarAction>,
  includedActionsArray: Field[],
  validatorSet: Array<[PrivateKey, PublicKey]>
) {
  const includedActionsMap = new Map<string, number>();

  for (const field of includedActionsArray.map((x) => x.toString())) {
    log('field:', field.toString());
    const count = includedActionsMap.get(field) || 0;
    includedActionsMap.set(field, count + 1);

    log('includedActionsMap:', includedActionsMap);
    log('includedActionsMap.get(field):', includedActionsMap.get(field));
  }

  const { publicInput, mask } = await CalculateMask(
    contractInstance,
    includedActionsMap,
    batchActions
  );

  const signatureList = GenerateReducerSignatureList(publicInput, validatorSet);

  return {
    validateReduceProof: await GenerateValidateReduceProof(
      publicInput,
      signatureList
    ),
    mask,
  };
}
