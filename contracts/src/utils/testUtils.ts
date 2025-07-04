import {
  Field,
  Poseidon,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
} from 'o1js';
import {
  Block,
  BlockList,
  MultisigVerifierProgram,
  SettlementProof,
} from '../SettlementProof.js';
import {
  GenerateValidateReduceProof,
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
  GeneratePulsarBlock,
} from './generateFunctions.js';
import { ValidateReducePublicInput } from '../ValidateReduce.js';
import {
  SignaturePublicKeyList,
  SignaturePublicKeyMatrix,
} from '../types/signaturePubKeyList.js';
import { List } from '../types/common.js';
import { PulsarAction } from '../types/PulsarAction.js';
import { ProofGenerators } from '../types/proofGenerators.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers.js';
import { SETTLEMENT_MATRIX_SIZE } from './constants.js';

export const TestUtils = {
  GenerateSignaturePubKeyList,
  GenerateSignaturePubKeyMatrix,
  GenerateReducerSignatureList,
  GenerateTestSettlementProof,
  MockReducerVerifierProof,
  GenerateTestActions,
  CalculateActionRoot,
  GenerateTestBlocks,
  CreateValidatorMerkleList,
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

function GenerateSignaturePubKeyMatrix(
  blocks: Block[],
  signerSet: Array<Array<[PrivateKey, PublicKey]>>
) {
  const signatureMatrix = [];

  for (let i = 0; i < SETTLEMENT_MATRIX_SIZE; i++) {
    signatureMatrix.push(
      GenerateSignaturePubKeyList(blocks[i].hash().toFields(), signerSet[i])
    );
  }
  return SignaturePublicKeyMatrix.fromArray(
    signatureMatrix.map((list) =>
      list.list.map((item) => [item.signature, item.publicKey])
    )
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
  if (
    newBlockHeight - initialBlockHeight <= 0 ||
    (newBlockHeight - initialBlockHeight) % SETTLEMENT_MATRIX_SIZE !== 0
  ) {
    throw new Error(
      `newBlockHeight must be greater than initialBlockHeight and difference must be a multiple of ${SETTLEMENT_MATRIX_SIZE}`
    );
  }

  const settlementProofs: SettlementProof[] = [];

  const merkleList = CreateValidatorMerkleList(validatorSet);

  let blocks: Block[] = [];
  let index = 1;
  for (let i = initialBlockHeight; i < newBlockHeight; i++, index++) {
    const block = GeneratePulsarBlock(
      merkleList.hash,
      Field.from(
        i == initialBlockHeight
          ? initialStateRoot
          : blocks[i - initialBlockHeight - 1].NewStateRoot
      ),
      Field.from(i),
      merkleList.hash,
      Field.from(i == newBlockHeight - 1 ? newStateRoot : Field.random()),
      Field.from(i + 1)
    );
    blocks.push(block);

    if (index % SETTLEMENT_MATRIX_SIZE === 0) {
      const publicInput = GenerateSettlementPublicInput(
        merkleList.hash,
        blocks[blocks.length - SETTLEMENT_MATRIX_SIZE].InitialStateRoot,
        blocks[blocks.length - SETTLEMENT_MATRIX_SIZE].InitialBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight,
        [validatorSet[0][1]]
      );

      const signatureMatrix = GenerateSignaturePubKeyMatrix(
        blocks.slice(-SETTLEMENT_MATRIX_SIZE),
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      const proof = (
        await MultisigVerifierProgram.verifySignatures(
          publicInput,
          signatureMatrix,
          validatorSet[0][1],
          BlockList.fromArray(blocks.slice(-SETTLEMENT_MATRIX_SIZE))
        )
      ).proof;

      settlementProofs.push(proof);
    }
  }

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

function GenerateTestBlocks(
  initialBlockHeight: Field,
  initialMerkleListRoot: Field,
  initialStateRoot: Field = Field(0)
): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < SETTLEMENT_MATRIX_SIZE; i++) {
    blocks.push(
      GeneratePulsarBlock(
        initialMerkleListRoot,
        initialStateRoot,
        initialBlockHeight,
        initialMerkleListRoot,
        initialStateRoot.add(Field(1)),
        initialBlockHeight.add(Field(1))
      )
    );
    initialBlockHeight = initialBlockHeight.add(Field(1));
    initialStateRoot = initialStateRoot.add(Field(1));
  }

  return blocks;
}
