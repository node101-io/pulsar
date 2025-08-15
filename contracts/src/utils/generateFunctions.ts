import { Bool, Field, PublicKey } from 'o1js';
import {
  Block,
  BlockList,
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
} from '../SettlementProof.js';
import { ProofGenerators } from '../types/proofGenerators.js';
import {
  ValidateReducePublicInput,
  ValidateReduceProgram,
  ValidateReduceProof,
} from '../ValidateReduce.js';
import {
  SignaturePublicKeyList,
  SignaturePublicKeyMatrix,
} from '../types/signaturePubKeyList.js';
import { log, table } from './loggers.js';
import { PulsarAction } from '../types/PulsarAction.js';
import { ACTION_QUEUE_SIZE, SETTLEMENT_MATRIX_SIZE } from './constants.js';
import { ActionStackProgram, ActionStackQueue } from '../ActionStack.js';

export {
  GenerateSettlementProof,
  MergeSettlementProofs,
  GenerateSettlementPublicInput,
  GenerateValidateReduceProof,
  GenerateActionStackProof,
  GeneratePulsarBlock,
};

async function GenerateSettlementProof(
  blocks: Array<Block>,
  signaturePublicKeyLists: Array<SignaturePublicKeyList>,
  proofGenerator: PublicKey
) {
  let proof: SettlementProof;
  if (blocks.length !== SETTLEMENT_MATRIX_SIZE) {
    throw new Error(
      `Expected ${SETTLEMENT_MATRIX_SIZE} blocks, but got ${blocks.length}`
    );
  }

  if (signaturePublicKeyLists.length !== SETTLEMENT_MATRIX_SIZE) {
    throw new Error(
      `Expected ${SETTLEMENT_MATRIX_SIZE} signature public key lists, but got ${signaturePublicKeyLists.length}`
    );
  }

  const publicInputs = new SettlementPublicInputs({
    InitialMerkleListRoot: blocks[0].InitialMerkleListRoot,
    InitialStateRoot: blocks[0].InitialStateRoot,
    InitialBlockHeight: blocks[0].InitialBlockHeight,
    NewBlockHeight: blocks[SETTLEMENT_MATRIX_SIZE - 1].NewBlockHeight,
    NewMerkleListRoot: blocks[SETTLEMENT_MATRIX_SIZE - 1].NewMerkleListRoot,
    NewStateRoot: blocks[SETTLEMENT_MATRIX_SIZE - 1].NewStateRoot,
    ProofGeneratorsList: ProofGenerators.empty().insertAt(
      Field(0),
      proofGenerator
    ),
  });

  try {
    proof = (
      await MultisigVerifierProgram.verifySignatures(
        publicInputs,
        SignaturePublicKeyMatrix.fromSignaturePublicKeyLists(
          signaturePublicKeyLists
        ),
        proofGenerator,
        BlockList.fromArray(blocks)
      )
    ).proof;
  } catch (error) {
    console.error('Error generating settlement proof:', error);
    throw error;
  }
  return proof;
}

async function MergeSettlementProofs(proofs: Array<SettlementProof>) {
  if (proofs.length < 2) {
    throw new Error('At least two proofs are required to merge');
  }

  log(
    'Unsorted proofs:',
    proofs.map((proof) => proof.publicInput.NewBlockHeight.toString())
  );

  proofs.sort((a, b) =>
    Number(
      a.publicInput.NewBlockHeight.toBigInt() -
        b.publicInput.NewBlockHeight.toBigInt()
    )
  );

  for (let i = 1; i < proofs.length; i++) {
    if (
      proofs[i].publicInput.InitialBlockHeight.toBigInt() !==
        proofs[i - 1].publicInput.NewBlockHeight.toBigInt() ||
      proofs[i].publicInput.InitialMerkleListRoot.toBigInt() !==
        proofs[i - 1].publicInput.NewMerkleListRoot.toBigInt()
    ) {
      throw new Error(
        `Proofs are not sequential: ${proofs[
          i - 1
        ].publicInput.NewBlockHeight.toString()} -> ${proofs[
          i
        ].publicInput.InitialBlockHeight.toString()}`
      );
    }
  }

  table(
    proofs.map((proof) => ({
      InitialBlockHeight: proof.publicInput.InitialBlockHeight.toString().slice(
        0,
        10
      ),
      InitialMerkleListRoot:
        proof.publicInput.InitialMerkleListRoot.toString().slice(0, 10),
      InitialStateRoot: proof.publicInput.InitialStateRoot.toString().slice(
        0,
        10
      ),
      NewBlockHeight: proof.publicInput.NewBlockHeight.toString().slice(0, 10),
      NewMerkleListRoot: proof.publicInput.NewMerkleListRoot.toString().slice(
        0,
        10
      ),
      NewStateRoot: proof.publicInput.NewStateRoot.toString().slice(0, 10),
    }))
  );

  let mergedProof = proofs[0];

  try {
    for (let i = 1; i < proofs.length; i++) {
      const proof = proofs[i];
      const publicInput = new SettlementPublicInputs({
        InitialMerkleListRoot: mergedProof.publicInput.InitialMerkleListRoot,
        InitialStateRoot: mergedProof.publicInput.InitialStateRoot,
        InitialBlockHeight: mergedProof.publicInput.InitialBlockHeight,
        NewBlockHeight: proof.publicInput.NewBlockHeight,
        NewMerkleListRoot: proof.publicInput.NewMerkleListRoot,
        NewStateRoot: proof.publicInput.NewStateRoot,
        ProofGeneratorsList:
          mergedProof.publicInput.ProofGeneratorsList.appendList(
            mergedProof.publicOutput.numberOfSettlementProofs.div(
              Field(SETTLEMENT_MATRIX_SIZE)
            ),
            proof.publicInput.ProofGeneratorsList
          ),
      });

      mergedProof = (
        await MultisigVerifierProgram.mergeProofs(
          publicInput,
          mergedProof,
          proof
        )
      ).proof;
    }
  } catch (error) {
    console.error('Error merging settlement proofs:', error);
    throw error;
  }
  return mergedProof;
}

function GenerateSettlementPublicInput(
  initialMerkleListRoot: Field,
  initialStateRoot: Field,
  initialBlockHeight: Field,
  newMerkleListRoot: Field,
  newStateRoot: Field,
  newBlockHeight: Field,
  proofGeneratorsList: Array<PublicKey>
) {
  let proofGenerators = ProofGenerators.empty();
  for (let i = 0; i < proofGeneratorsList.length; i++) {
    proofGenerators.insertAt(Field(i), proofGeneratorsList[i]);
  }

  return new SettlementPublicInputs({
    InitialMerkleListRoot: initialMerkleListRoot,
    InitialStateRoot: initialStateRoot,
    InitialBlockHeight: initialBlockHeight,
    NewBlockHeight: newBlockHeight,
    NewMerkleListRoot: newMerkleListRoot,
    NewStateRoot: newStateRoot,
    ProofGeneratorsList: proofGenerators,
  });
}

function GeneratePulsarBlock(
  initialMerkleListRoot: Field,
  initialStateRoot: Field,
  initialBlockHeight: Field,
  newMerkleListRoot: Field,
  newStateRoot: Field,
  newBlockHeight: Field
) {
  return new Block({
    InitialMerkleListRoot: initialMerkleListRoot,
    InitialStateRoot: initialStateRoot,
    InitialBlockHeight: initialBlockHeight,
    NewBlockHeight: newBlockHeight,
    NewMerkleListRoot: newMerkleListRoot,
    NewStateRoot: newStateRoot,
  });
}

async function GenerateValidateReduceProof(
  publicInputs: ValidateReducePublicInput,
  signaturePublicKeyList: SignaturePublicKeyList
) {
  let proof: ValidateReduceProof;
  try {
    proof = (
      await ValidateReduceProgram.verifySignatures(
        publicInputs,
        signaturePublicKeyList
      )
    ).proof;
  } catch (error) {
    console.error('Error generating reducer verifier proof:', error);
    throw error;
  }
  return proof;
}

async function GenerateActionStackProof(
  endActionState: Field,
  actions: PulsarAction[]
) {
  let proof = (
    await ActionStackProgram.proveBase(
      endActionState,
      ActionStackQueue.fromArray(actions.slice(0, ACTION_QUEUE_SIZE))
    )
  ).proof;

  if (actions.length === 0) {
    return {
      useActionStack: Bool(false),
      actionStackProof: proof,
    };
  }

  try {
    for (let i = 0; i < Math.ceil(actions.length / ACTION_QUEUE_SIZE); i++) {
      proof = (
        await ActionStackProgram.proveRecursive(
          proof.publicOutput,
          proof,
          ActionStackQueue.fromArray(
            actions.slice(i * ACTION_QUEUE_SIZE, (i + 1) * ACTION_QUEUE_SIZE)
          )
        )
      ).proof;
    }

    return {
      useActionStack: Bool(true),
      actionStackProof: proof,
    };
  } catch (error) {
    console.error('Error generating action stack proof:', error);
    throw error;
  }
}
