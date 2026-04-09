import { Types } from "mongoose";
import mongoose from "mongoose";

import {
    ProofEpochModel,
    BlockEpochModel,
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
} from "pulsar-contracts";
import { Field, PublicKey, Signature } from "o1js";

let compiled = false;
async function ensureCompiled() {
    if (!compiled) {
        await MultisigVerifierProgram.compile();
        compiled = true;
    }
}

export async function worker(task: BlockProverJob) {
    const blockEpochHeight = task.height;

    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const epoch = await BlockEpochModel.findOne({
                height: blockEpochHeight,
                epochStatus: { $eq: "processing" as BlockStatus },
            });

            if (!epoch) {
                throw new Error(
                    `BlockEpoch at height ${blockEpochHeight} not found.`,
                );
            }

            if (epoch.failCount > 0) {
                const proofEpochHeight =
                    Math.floor(blockEpochHeight / PROOF_EPOCH_SIZE) * PROOF_EPOCH_SIZE;
                const proofEpoch = await ProofEpochModel.findOne({
                    height: proofEpochHeight,
                    kind: "blockProof" as ProofKind,
                });

                if (proofEpoch && proofEpoch.proofs.some((p) => p !== null)) {
                    logger.info(
                        `Skipping block proof generation for epoch starting at height ${blockEpochHeight} because proofs already exist after previous failures.`,
                    );
                    return;
                }
            }

            await ensureCompiled();
            const proofId = await createProof(blockEpochHeight);

            await createOrUpdateProofEpoch(epoch.height, proofId);

            await BlockEpochModel.findOneAndUpdate(
                { height: blockEpochHeight },
                { $set: { epochStatus: "done" as BlockStatus } },
            );

            logger.info(
                `Processed block epoch starting at height ${blockEpochHeight} and stored proofs in proof epochs.`,
            );
        });
    } finally {
        await session.endSession();
    }
}

async function createProof(height: number) {
    const rangeLow = height - 1; // include previous block as context for first pair
    const rangeHigh = height + BLOCK_EPOCH_SIZE - 1;

    const blockDocs = await fetchBlockRange(rangeLow, rangeHigh);

    if (blockDocs.length !== BLOCK_EPOCH_SIZE + 1) {
        throw new Error(
            `Expected ${BLOCK_EPOCH_SIZE + 1} blocks for proof starting at height ${height}, but got ${blockDocs.length}`,
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
        Math.floor(blockEpochHeight / BLOCK_EPOCH_SIZE) % PROOF_EPOCH_LEAF_COUNT;

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
