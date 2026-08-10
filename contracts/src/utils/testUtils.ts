import {
  Bool,
  Field,
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
  GenerateApprovalQuorumProof,
  GenerateApprovalTailProof,
  GenerateSettlementPublicInput,
  MergeSettlementProofs,
  GeneratePulsarBlock,
} from './generateFunctions.js';
import { ApprovalQuorumProof } from '../ApprovalQuorum.js';
import {
  SignaturePublicKeyList,
  SignaturePublicKeyMatrix,
} from '../types/signaturePubKeyList.js';
import { ApprovalVerdicts, List } from '../types/common.js';
import { VoteExtBody } from '../types/voteExtBody.js';
import {
  computeValidatorListHash,
  hashValidatorLeaf,
} from './validatorList.js';
import {
  CosmosSignature,
  PulsarAction,
  PulsarAuth,
} from '../types/PulsarAction.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers.js';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from './pulsarActionLeaf.js';
import { BATCH_SIZE, SETTLEMENT_MATRIX_SIZE } from './constants.js';

export const TestUtils = {
  GenerateSignaturePubKeyList,
  GenerateSignaturePubKeyMatrix,
  GenerateTestSettlementProof,
  MockApprovalQuorumProof,
  FoldVerdictLeaves,
  GenerateTestActions,
  CalculateActionRoot,
  GenerateTestBlocks,
  GenerateTestBlocksWithRotation,
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
    // power = Field(1) (uniform in tests; must match CreateValidatorMerkleList)
    signatures.map((signature, i) => [signature, signerSet[i][1], Field(1)])
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
      list.list.map((item) => [item.signature, item.publicKey, item.power])
    )
  );
}

function CreateValidatorMerkleList(
  validatorSet: Array<[PrivateKey, PublicKey]>
) {
  const merkleList = List.empty();

  for (let i = 0; i < validatorSet.length; i++) {
    const [, publicKey] = validatorSet[i];
    // power = Field(1): must match the sig lists
    merkleList.push(hashValidatorLeaf(publicKey, Field(1)));
  }

  return merkleList;
}

/** Fold v2 verdict leaves for `actions` (verdict per slot) onto `cursor`. */
function FoldVerdictLeaves(
  cursor: Field,
  actions: PulsarAction[],
  verdicts: boolean[]
): Field {
  return actions.reduce(
    (acc, action, i) =>
      foldApprovalCursor(acc, hashPulsarActionLeafV2(action, Bool(verdicts[i]))),
    cursor
  );
}

/**
 * Chain stand-in for unit tests: folds v2
 * verdict leaves and signs a REAL vote-extension body with local keys — a
 * stand-in signing the real message, not a fake signer of a fabricated one.
 * Successor to MockReducerVerifierProof, which signed the deleted
 * ValidateReduce batch commitment nothing chain-side ever produces.
 *
 * The signed cursor derives from the SIGNED verdicts over the SCANNED prefix,
 * independent of what the contract folds — so tests can diverge the two on
 * purpose:
 * - signedVerdicts != verdicts  -> verdict-flip rejection cases;
 * - scannedCount < batch length -> "batch beyond the chain's scan";
 * - tailLeaves                  -> scanned-but-unconsumed suffix the tail
 *                                  proof absorbs (batch shorter than the
 *                                  signed prefix).
 */
async function MockApprovalQuorumProof(opts: {
  validatorSet: Array<[PrivateKey, PublicKey]>;
  cursorBefore: Field;
  batchActions: PulsarAction[];
  /** what the CONTRACT folds, one bool per batch action */
  verdicts: boolean[];
  /** what the CHAIN signed (default: verdicts) */
  signedVerdicts?: boolean[];
  /** how many batch actions the chain has scanned (default: all) */
  scannedCount?: number;
  /** leaves beyond the batch that the tail proof must absorb (default: none) */
  tailLeaves?: Field[];
}): Promise<{
  verdicts: ApprovalVerdicts;
  approvalProof: ApprovalQuorumProof;
  cursorAfter: Field;
}> {
  const {
    validatorSet,
    cursorBefore,
    batchActions,
    verdicts,
    signedVerdicts = verdicts,
    scannedCount = batchActions.length,
    tailLeaves = [],
  } = opts;

  const cursorAfter = FoldVerdictLeaves(
    cursorBefore,
    batchActions.slice(0, scannedCount),
    signedVerdicts.slice(0, scannedCount)
  );
  const signedRoot = tailLeaves.reduce(
    (cursor, leaf) => foldApprovalCursor(cursor, leaf),
    cursorAfter
  );

  const body = new VoteExtBody({
    // power = Field(1): must match GenerateSignaturePubKeyList
    nextValidatorSetHash: computeValidatorListHash(
      validatorSet.map(([, publicKey]) => ({ publicKey, power: Field(1) }))
    ),
    stateRootHi: Field(123),
    stateRootLo: Field(456),
    currentBlockHeight: Field(42),
    actionsReducedRoot: signedRoot,
  });

  const approvalProof = await GenerateApprovalQuorumProof(
    cursorAfter,
    body,
    GenerateSignaturePubKeyList([body.hash()], validatorSet),
    await GenerateApprovalTailProof(cursorAfter, tailLeaves)
  );

  return {
    verdicts: ApprovalVerdicts.fromArray([
      ...verdicts,
      ...new Array(BATCH_SIZE - verdicts.length).fill(false),
    ]),
    approvalProof,
    cursorAfter,
  };
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
        blocks[blocks.length - 1].NewBlockHeight
      );

      const signatureMatrix = GenerateSignaturePubKeyMatrix(
        blocks.slice(-SETTLEMENT_MATRIX_SIZE),
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      const proof = (
        await MultisigVerifierProgram.verifySignatures(
          publicInput,
          signatureMatrix,
          BlockList.fromArray(blocks.slice(-SETTLEMENT_MATRIX_SIZE))
        )
      ).proof;

      settlementProofs.push(proof);
    }
  }

  let mergedProof = await MergeSettlementProofs(settlementProofs);

  return mergedProof;
}

function GenerateTestActions(numActions: number): PulsarAction[] {
  const actions: PulsarAction[] = [];
  for (let i = 0; i < numActions; i++) {
    const randomType = Math.ceil(Math.random() * 2);
    if (randomType === 1) {
      actions.push(
        PulsarAction.deposit(
          PrivateKey.random().toPublicKey(),
          UInt64.from(Math.floor(Math.random() * 2 ** 32)).value,
          PulsarAuth.from(Field(0), CosmosSignature.empty())
        )
      );
    } else if (randomType === 2) {
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

/**
 * Generates SETTLEMENT_MATRIX_SIZE blocks where the validator set rotates at
 * `rotationIndex`. Block at rotationIndex has NewMerkleListRoot = newMerkleListRoot;
 * all subsequent blocks use newMerkleListRoot as their InitialMerkleListRoot.
 * Blocks before rotationIndex keep the initial merkle root throughout.
 */
function GenerateTestBlocksWithRotation(
  initialBlockHeight: Field,
  initialMerkleListRoot: Field,
  newMerkleListRoot: Field,
  rotationIndex: number,
  initialStateRoot: Field = Field(0)
): Block[] {
  const blocks: Block[] = [];
  let currentMerkleRoot = initialMerkleListRoot;

  for (let i = 0; i < SETTLEMENT_MATRIX_SIZE; i++) {
    const nextMerkleRoot = i === rotationIndex ? newMerkleListRoot : currentMerkleRoot;

    blocks.push(
      GeneratePulsarBlock(
        currentMerkleRoot,
        initialStateRoot,
        initialBlockHeight,
        nextMerkleRoot,
        initialStateRoot.add(Field(1)),
        initialBlockHeight.add(Field(1))
      )
    );

    initialBlockHeight = initialBlockHeight.add(Field(1));
    initialStateRoot = initialStateRoot.add(Field(1));
    currentMerkleRoot = nextMerkleRoot;
  }

  return blocks;
}
