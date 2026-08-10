import { Bool, Field } from 'o1js';
import {
  Block,
  BlockList,
  MultisigVerifierProgram,
  SettlementProof,
  SettlementPublicInputs,
} from '../SettlementProof.js';
import {
  ApprovalQuorumProgram,
  ApprovalQuorumProof,
  ApprovalQuorumPublicInput,
} from '../ApprovalQuorum.js';
import { VoteExtBody } from '../types/voteExtBody.js';
import {
  SignaturePublicKeyList,
  SignaturePublicKeyMatrix,
} from '../types/signaturePubKeyList.js';
import { log, table } from './loggers.js';
import { PulsarAction } from '../types/PulsarAction.js';
import {
  ACTION_QUEUE_SIZE,
  APPROVAL_TAIL_CHUNK,
  SETTLEMENT_MATRIX_SIZE,
} from './constants.js';
import {
  ActionStackProgram,
  ActionStackProof,
  ActionStackQueue,
} from '../ActionStack.js';
import {
  ApprovalTailProgram,
  ApprovalTailProof,
  ApprovalTailQueue,
} from '../ApprovalTail.js';

export {
  GenerateSettlementProof,
  MergeSettlementProofs,
  GenerateSettlementPublicInput,
  GenerateApprovalQuorumProof,
  GenerateActionStackProof,
  GenerateApprovalTailProof,
  GeneratePulsarBlock,
};

async function GenerateSettlementProof(
  blocks: Array<Block>,
  signaturePublicKeyLists: Array<SignaturePublicKeyList>
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
  });

  try {
    proof = (
      await MultisigVerifierProgram.verifySignatures(
        publicInputs,
        SignaturePublicKeyMatrix.fromSignaturePublicKeyLists(
          signaturePublicKeyLists
        ),
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
  newBlockHeight: Field
) {
  return new SettlementPublicInputs({
    InitialMerkleListRoot: initialMerkleListRoot,
    InitialStateRoot: initialStateRoot,
    InitialBlockHeight: initialBlockHeight,
    NewBlockHeight: newBlockHeight,
    NewMerkleListRoot: newMerkleListRoot,
    NewStateRoot: newStateRoot,
  });
}

function GeneratePulsarBlock(
  initialMerkleListRoot: Field,
  initialStateRoot: Field,
  initialBlockHeight: Field,
  newMerkleListRoot: Field,
  newStateRoot: Field,
  newBlockHeight: Field,
  actionsReducedRoot: Field = Field.from(0)
) {
  return new Block({
    InitialMerkleListRoot: initialMerkleListRoot,
    InitialStateRoot: initialStateRoot,
    InitialBlockHeight: initialBlockHeight,
    NewBlockHeight: newBlockHeight,
    NewMerkleListRoot: newMerkleListRoot,
    NewStateRoot: newStateRoot,
    actionsReducedRoot,
  });
}

/**
 * Successor to the deleted GenerateValidateReduceProof: the message is the
 * chain's own vote-extension body, so the signature list comes from archived
 * vote extensions, never from a bespoke signing round.
 * Non-signers must occupy their slots with the dummy Signature {r:1, s:1} —
 * the circuit rebuilds the validator list from all VALIDATOR_NUMBER slots.
 *
 * cursorAfter is the approval cursor the contract reaches after folding the
 * batch; tailProof (GenerateApprovalTailProof(cursorAfter, tailLeaves)) must
 * extend it to body.actionsReducedRoot — for a batch that consumes the whole
 * signed prefix, that is the empty tail, i.e.
 * GenerateApprovalTailProof(body.actionsReducedRoot, []).
 */
async function GenerateApprovalQuorumProof(
  cursorAfter: Field,
  body: VoteExtBody,
  signaturePublicKeyList: SignaturePublicKeyList,
  tailProof: ApprovalTailProof
) {
  let proof: ApprovalQuorumProof;
  try {
    proof = (
      await ApprovalQuorumProgram.verifySignatures(
        new ApprovalQuorumPublicInput({
          validatorSetRoot: body.nextValidatorSetHash,
          cursorAfter,
        }),
        body,
        signaturePublicKeyList,
        tailProof
      )
    ).proof;
  } catch (error) {
    console.error('Error generating approval quorum proof:', error);
    throw error;
  }
  return proof;
}

async function GenerateActionStackProof(
  endActionState: Field,
  actions: PulsarAction[]
) {
  if (actions.length === 0) {
    // The contract ignores the proof when useActionStack is false but still
    // verifies its shape — the dummy convention matches reduceWitness.ts and
    // replaces a pointlessly real proveBase over an empty queue.
    return {
      useActionStack: Bool(false),
      actionStackProof: await ActionStackProof.dummy(Field(0), Field(0), 1, 14),
    };
  }

  let proof = (
    await ActionStackProgram.proveBase(
      endActionState,
      ActionStackQueue.fromArray(actions.slice(0, ACTION_QUEUE_SIZE))
    )
  ).proof;

  try {
    for (let i = 1; i < Math.ceil(actions.length / ACTION_QUEUE_SIZE); i++) {
      proof = (
        await ActionStackProgram.proveRecursive(
          // endActionState is the anchor the contract asserts against — it
          // must be passed unchanged to every layer, never the running fold.
          endActionState,
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

async function GenerateApprovalTailProof(
  anchor: Field,
  leaves: Field[]
): Promise<ApprovalTailProof> {
  // No dummy-proof shortcut here, unlike GenerateActionStackProof:
  // ApprovalQuorumProgram verifies the tail proof unconditionally, so the
  // empty tail is a REAL base proof over an all-dummy queue and returns its
  // input unchanged (empty tail == identity).
  try {
    let proof = (
      await ApprovalTailProgram.proveBase(
        anchor,
        ApprovalTailQueue.fromLeaves(leaves.slice(0, APPROVAL_TAIL_CHUNK))
      )
    ).proof;

    for (let i = 1; i < Math.ceil(leaves.length / APPROVAL_TAIL_CHUNK); i++) {
      proof = (
        await ApprovalTailProgram.proveRecursive(
          // anchor is what ApprovalQuorumProgram asserts equals the batch-end
          // cursor — it must be passed unchanged to every layer, never the
          // running fold.
          anchor,
          proof,
          ApprovalTailQueue.fromLeaves(
            leaves.slice(i * APPROVAL_TAIL_CHUNK, (i + 1) * APPROVAL_TAIL_CHUNK)
          )
        )
      ).proof;
    }

    return proof;
  } catch (error) {
    console.error('Error generating approval tail proof:', error);
    throw error;
  }
}
