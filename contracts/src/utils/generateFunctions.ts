import { Field, Poseidon, PublicKey } from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
} from '../SettlementProof';
import { ProofGenerators } from '../types/proofGenerators';
import {
  ReducePublicInputs,
  ReduceVerifierProgram,
  ReduceVerifierProof,
} from '../ReducerVerifierProof';
import { SignaturePublicKeyList } from '../types/signaturePubKeyList';
import { BATCH_SIZE } from './constants';
import { ActionType } from '../types/action';
import { SettlementContract } from '../SettlementContract';
import { ReduceMask } from '../types/common';

export {
  GenerateSettlementProof,
  MergeSettlementProofs,
  GenerateSettlementPublicInput,
  GenerateReducerVerifierProof,
  PrepareReduce,
};

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

  console.table(
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

async function GenerateReducerVerifierProof(
  publicInputs: ReducePublicInputs,
  signaturePublicKeyList: SignaturePublicKeyList
) {
  let proof: ReduceVerifierProof;
  try {
    proof = (
      await ReduceVerifierProgram.verifySignatures(
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

async function PrepareReduce(
  contractInstance: SettlementContract,
  actionStack: Map<string, number>,
  actions: Array<ActionType>
) {
  let mask = new Array<boolean>(BATCH_SIZE).fill(false);
  let publicInput = new ReducePublicInputs({
    stateRoot: contractInstance.stateRoot.get(),
    merkleListRoot: contractInstance.merkleListRoot.get(),
    blockHeight: contractInstance.blockHeight.get(),
    depositListHash: contractInstance.depositListHash.get(),
    withdrawalListHash: contractInstance.withdrawalListHash.get(),
    rewardListHash: contractInstance.rewardListHash.get(),
  });

  console.log('publicInput:', publicInput.toJSON());

  console.log(
    'actions:',
    actions.map((action) => action.toJSON())
  );

  for (let i = 0; i < BATCH_SIZE && i < actions.length; i++) {
    const action = actions[i];

    // console.log('index:', i, 'action:', action.toJSON());

    const hash = action.unconstrainedHash().toString();

    // console.log('hash:', hash.toString());
    // console.log('has', actionStack.has(hash));
    // console.log('get', actionStack.get(hash));
    // console.log(
    //   'actionStack:',
    //   actionStack.forEach((v, k) => {
    //     console.log(k.toString(), v);
    //   })
    // );

    const count = actionStack.get(hash);

    if (
      Number(action.type.toString()) !== 0 &&
      count !== undefined &&
      count > 0
    ) {
      const count = actionStack.get(hash)!;

      mask[i] = true;
      actionStack.set(hash, count - 1);

      if (ActionType.isSettlement(action).toBoolean()) {
        console.log('Settlement');
        publicInput = new ReducePublicInputs({
          ...publicInput,
          stateRoot: action.newState,
          merkleListRoot: action.newMerkleListRoot,
          blockHeight: action.newBlockHeight,
          rewardListHash: Poseidon.hash([
            publicInput.rewardListHash,
            action.rewardListUpdateHash,
          ]),
        });
      } else if (ActionType.isDeposit(action).toBoolean()) {
        console.log('Deposit');
        publicInput = new ReducePublicInputs({
          ...publicInput,
          depositListHash: Poseidon.hash([
            publicInput.depositListHash,
            ...action.account.toFields(),
            action.amount,
          ]),
        });
      } else if (ActionType.isWithdrawal(action).toBoolean()) {
        console.log('Withdrawal');
        publicInput = new ReducePublicInputs({
          ...publicInput,
          withdrawalListHash: Poseidon.hash([
            publicInput.withdrawalListHash,
            ...action.account.toFields(),
            action.amount,
          ]),
        });
      }
      console.log('updated publicInput:', publicInput.toJSON());
    }
  }

  return {
    publicInput,
    mask: ReduceMask.fromArray(mask),
  };
}
