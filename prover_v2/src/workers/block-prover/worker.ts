import { Types } from "mongoose";

import {
    ProofEpochModel,
    BlockEpochModel,
    BlockModel,
    storeProof,
    fetchBlockRange,
} from "../../db/index.js";
import {
    WORKER_TIMEOUT_MS,
    BLOCK_EPOCH_SIZE,
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SIZE,
} from "../../config/constants.js";
import { BlockStatus, ProofKind, ProofStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { BlockProverJob } from "../types.js";
import {
    GeneratePulsarBlock,
    GenerateSettlementProof,
    SignaturePublicKeyList,
    MultisigVerifierProgram,
    Field,
    PublicKey,
    Signature,
} from "pulsar-contracts";

let compiled = false;
let compileLock: Promise<void> = Promise.resolve();
async function ensureCompiled() {
    compileLock = compileLock.then(async () => {
        if (!compiled) {
            await MultisigVerifierProgram.compile();
            compiled = true;
        }
    });
    await compileLock;
}

// o1js does not support concurrent proving within the same process.
// All prove calls must be serialized.
let provingQueue: Promise<void> = Promise.resolve();
function serializeProving<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        provingQueue = provingQueue.then(() => fn().then(resolve, reject));
    });
}

export async function worker(task: BlockProverJob) {
    const { height: epochHeight, blockIndex } = task;
    const blockHeight = epochHeight + blockIndex;

    // Mark the individual Block as done
    await BlockModel.findOneAndUpdate(
        { height: blockHeight },
        { $set: { status: "done" as BlockStatus } },
    );

    const updatedEpoch = await BlockEpochModel.findOneAndUpdate(
        { height: epochHeight, epochStatus: "processing" as BlockStatus },
        { $set: { [`status.${blockIndex}`]: "done" as BlockStatus } },
        { new: true },
    );

    if (!updatedEpoch) {
        logger.warn(
            `BlockEpoch ${epochHeight} not found or not in processing state, skipping block ${blockHeight}`,
        );
        return;
    }

    logger.info(
        `Block ${blockHeight} (index ${blockIndex}) marked done in epoch ${epochHeight}`,
        { epochHeight, blockIndex, blockHeight, event: "block_marked_done" },
    );

    const allDone = (updatedEpoch.status as string[]).every(
        (s) => s === "done",
    );
    if (!allDone) return;

    logger.info(
        `All blocks done for epoch ${epochHeight}, generating settlement proof`,
        { epochHeight, event: "all_blocks_done" },
    );

    // Skip proof generation if a proof already exists (re-run after failure)
    if (updatedEpoch.failCount > 0) {
        const proofEpochHeight =
            Math.floor(epochHeight / PROOF_EPOCH_SIZE) * PROOF_EPOCH_SIZE;
        const proofEpoch = await ProofEpochModel.findOne({
            height: proofEpochHeight,
            kind: "blockProof" as ProofKind,
        });

        if (proofEpoch && proofEpoch.proofs.some((p) => p !== null)) {
            logger.info(
                `Skipping proof generation for epoch ${epochHeight} — proof already exists after previous failure`,
            );
            await BlockEpochModel.findOneAndUpdate(
                { height: epochHeight },
                { $set: { epochStatus: "done" as BlockStatus } },
            );
            return;
        }
    }

    const proofId = await serializeProving(async () => {
        await ensureCompiled();
        return createProof(epochHeight);
    });
    await createOrUpdateProofEpoch(epochHeight, proofId);

    await BlockEpochModel.findOneAndUpdate(
        { height: epochHeight },
        { $set: { epochStatus: "done" as BlockStatus } },
    );

    logger.info(
        `Settlement proof generated for epoch ${epochHeight}, epoch marked done`,
        {
            epochHeight,
            proofId: proofId.toHexString(),
            event: "epoch_proof_done",
        },
    );
}

async function createProof(height: number) {
    const rangeLow = height - 1; // include previous block as context for first pair
    const rangeHigh = height + BLOCK_EPOCH_SIZE - 1;

    const blockDocs = await fetchBlockRange(rangeLow, rangeHigh);

    if (blockDocs.length !== BLOCK_EPOCH_SIZE + 1) {
        throw new Error(
            `Expected ${
                BLOCK_EPOCH_SIZE + 1
            } blocks for proof starting at height ${height}, but got ${
                blockDocs.length
            }`,
        );
    }

    const blocks = [];
    const signaturePubKeyLists: SignaturePublicKeyList[] = [];

    for (let i = 1; i < blockDocs.length; i++) {
        const prev = blockDocs[i - 1];
        const cur = blockDocs[i];

        const block = GeneratePulsarBlock(
            Field.from(prev.validatorListHash),
            Field.from(prev.stateRoot),
            Field.from(prev.height),
            Field.from(cur.validatorListHash),
            Field.from(cur.stateRoot),
            Field.from(cur.height),
        );
        blocks.push(block);

        const sigList = SignaturePublicKeyList.fromArray(
            cur.voteExt.map((ext) => [
                Signature.fromBase58(ext.signature),
                PublicKey.fromBase58(ext.validatorAddr),
            ]),
        );
        signaturePubKeyLists.push(sigList);
    }

    // // !DEBUG: verify signer hash matches prev.validatorListHash for each block pair
    // for (let i = 1; i < blockDocs.length; i++) {
    //     const prev = blockDocs[i - 1];
    //     const cur = blockDocs[i];
    //     const signerList = List.empty();
    //     for (const ext of cur.voteExt) {
    //         signerList.push(
    //             Poseidon.hash(
    //                 PublicKey.fromBase58(ext.validatorAddr).toFields(),
    //             ),
    //         );
    //     }
    //     const signerHash = signerList.hash.toString();
    //     logger.debug(`Validator hash check ${prev.height}→${cur.height}`, {
    //         prevValidatorListHash: prev.validatorListHash,
    //         signerHash,
    //         match: prev.validatorListHash === signerHash,
    //         prevValidators: prev.validators,
    //         curVoteExtSigners: cur.voteExt.map((e) => e.validatorAddr),
    //         event: "validator_hash_debug",
    //     });
    // }

    const settlementProof = await GenerateSettlementProof(
        blocks,
        signaturePubKeyLists,
    );

    const proofJson = JSON.stringify(settlementProof.toJSON());

    const proofId = await storeProof(proofJson);

    logger.info(`Created proof ${proofId.toHexString()} for block ${height}`);

    return proofId;
}

/**
 * Creates a new proof epoch document if it does not exist and sets the block proof at the correct leaf index.
 * Multiple block epochs (PROOF_EPOCH_LEAF_COUNT of them) contribute leaf proofs to a single proof epoch.
 */
async function createOrUpdateProofEpoch(
    blockEpochHeight: number,
    proofId: Types.ObjectId,
) {
    const proofEpochHeight =
        Math.floor(blockEpochHeight / PROOF_EPOCH_SIZE) * PROOF_EPOCH_SIZE;
    const leafIndex =
        Math.floor(blockEpochHeight / BLOCK_EPOCH_SIZE) %
        PROOF_EPOCH_LEAF_COUNT;

    await ProofEpochModel.updateOne(
        { height: proofEpochHeight },
        {
            $setOnInsert: {
                height: proofEpochHeight,
                kind: "blockProof" as ProofKind,
                proofs: Array(PROOF_EPOCH_LEAF_COUNT * 2 - 1).fill(null),
                status: Array(PROOF_EPOCH_LEAF_COUNT - 1).fill(
                    "waiting" as ProofStatus,
                ),
                failCount: 0,
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
            },
        },
        { upsert: true },
    );

    const result = await ProofEpochModel.findOneAndUpdate(
        { height: proofEpochHeight },
        { $set: { [`proofs.${leafIndex}`]: proofId } },
        { new: true },
    );

    logger.info(
        `Stored block proof in proof epoch at height ${proofEpochHeight}, leaf index ${leafIndex}`,
    );

    return result;
}
