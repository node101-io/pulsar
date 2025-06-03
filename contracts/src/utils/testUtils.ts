import {
  Field,
  Poseidon,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
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
import { ValidateReducePublicInput } from '../ValidateReduce';
import { SignaturePublicKeyList } from '../types/signaturePubKeyList';
import { List } from '../types/common';
import { PulsarAction } from '../types/PulsarAction';
import { log } from './loggers.js';
import { ProofGenerators } from '../types/proofGenerators';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers';

export {
  GenerateSignaturePubKeyList,
  GenerateReducerSignatureList,
  GenerateTestSettlementProof,
  MockReducerVerifierProof,
  GenerateTestActions,
  CalculateActionRoot,
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
  publicInput: ValidateReducePublicInput,
  validatorSet: Array<[PrivateKey, PublicKey]>
) {
  const signatureList = GenerateReducerSignatureList(publicInput, validatorSet);

  return {
    validateReduceProof: await GenerateValidateReduceProof(
      publicInput,
      signatureList
    ),
  };
}

function GenerateTestActions(
  numActions: number,
  merkleListRoot: Field,
  initialStateRoot: Field = Field(0)
): PulsarAction[] {
  const actions: PulsarAction[] = [];
  let blockHeight = 1;
  for (let i = 0; i < numActions; i++) {
    const randomType = Math.ceil(Math.random() * 3);
    if (randomType === 1) {
      actions.push(
        PulsarAction.settlement(
          i == 0 ? initialStateRoot : Field.random(),
          Field.random(),
          merkleListRoot,
          merkleListRoot,
          Field.from(blockHeight++),
          Field.from(blockHeight++),
          ProofGenerators.empty().insertAt(
            Field.from(0),
            PrivateKey.random().toPublicKey()
          )
        )
      );
    } else if (randomType === 2) {
      actions.push(
        PulsarAction.deposit(
          PrivateKey.random().toPublicKey(),
          UInt64.from(Math.floor(Math.random() * 2 ** 32)).value
        )
      );
    } else if (randomType === 3) {
      actions.push(
        PulsarAction.withdrawal(
          PrivateKey.random().toPublicKey(),
          UInt64.from(Math.floor(Math.random() * 2 ** 32)).value
        )
      );
    }
  }
  return actions;
}

function CalculateActionRoot(initialRoot: Field, actions: PulsarAction[]) {
  let actionRoot = initialRoot;
  for (const action of actions) {
    actionRoot = merkleActionsAdd(
      actionRoot,
      actionListAdd(emptyActionListHash, action)
    );
  }
  return actionRoot;
}
