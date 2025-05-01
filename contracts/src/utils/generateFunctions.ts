import { Field, PublicKey } from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
  SignaturePublicKeyList,
} from '../SettlementProof';
import { ProofGenerators } from './proofGenerators';

export { GenerateSettlementProof, MergeSettlementProofs };

async function GenerateSettlementProof(
  publicInputs: SettlementPublicInputs,
  signaturePublicKeyList: SignaturePublicKeyList,
  proofGenerator: PublicKey
) {
  let proof: SettlementProof;
  try {
    proof = (
      await MultisigVerifierProgram.verifySignatures(
        publicInputs,
        signaturePublicKeyList,
        proofGenerator
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

  console.log(
    'Unsorted proofs:',
    proofs.map((proof) => proof.publicInput.NewBlockHeight.toString())
  );

  //sort the proofs by block height
  proofs.sort((a, b) => {
    return Number(
      a.publicInput.NewBlockHeight.toBigInt() <
        b.publicInput.NewBlockHeight.toBigInt()
    );
  });

  console.log(
    'Sorted proofs:',
    proofs.map((proof) => proof.publicInput.NewBlockHeight.toString())
  );

  let ProofGeneratorsList = ProofGenerators.empty();
  for (let i = 0; i < proofs.length; i++) {
    ProofGeneratorsList.list[i] =
      proofs[i].publicInput.ProofGeneratorsList.list[0];
  }

  let mergedProof = proofs[0];

  try {
    for (let i = 1; i < proofs.length; i++) {
      const proof = proofs[i];
      const publicInput = new SettlementPublicInputs({
        InitialMerkleListRoot: mergedProof.publicInput.NewMerkleListRoot,
        InitialStateRoot: mergedProof.publicInput.NewStateRoot,
        InitialBlockHeight: mergedProof.publicInput.NewBlockHeight,
        NewBlockHeight: proof.publicInput.NewBlockHeight,
        NewMerkleListRoot: proof.publicInput.NewMerkleListRoot,
        NewStateRoot: proof.publicInput.NewStateRoot,
        ProofGeneratorsList:
          mergedProof.publicInput.ProofGeneratorsList.appendList(
            Field(i),
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
