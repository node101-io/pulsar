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
    PROOF_EPOCH_SIZE,
    BLOCK_EPOCH_SIZE,
} from "../../utils/constants.js";
import { ProofKind, ProofStatus } from "../../db/types.js";
import logger from "../../../logger.js";
import { BlockProverJob } from "../utils/jobs.js";
import {
    GeneratePulsarBlock,
    GenerateSettlementProof,
    SignaturePublicKeyList,
} from "pulsar-contracts";
import { Field, PublicKey, Signature } from "o1js";

export async function worker(task: BlockProverJob) {
    const blockEpochHeight = task.height;

    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const epoch = await BlockEpochModel.findOne({
                height: blockEpochHeight,
            });

            if (!epoch) {
                throw new Error(
                    `BlockEpoch at height ${blockEpochHeight} not found.`,
                );
            }

            const proofId = await createProof(blockEpochHeight);

            await createOrUpdateProofEpoch(epoch.height, proofId);

            logger.info(
                `Processed block epoch starting at height ${blockEpochHeight} and stored proofs in proof epochs.`,
            );
        });
    } finally {
        await session.endSession();
    }
}

async function createProof(height: number) {
    const rangeLow = height;
    const rangeHigh = height + BLOCK_EPOCH_SIZE - 1;

    const blockDocs = await fetchBlockRange(rangeLow, rangeHigh);

    if (blockDocs.length !== BLOCK_EPOCH_SIZE) {
        throw new Error(
            `Expected ${
                BLOCK_EPOCH_SIZE
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
 * Creates a new block epoch document if it does not exist and sets the block at the given height
 */
async function createOrUpdateProofEpoch(
    height: number,
    proofId: Types.ObjectId,
) {
    const result = await ProofEpochModel.findOneAndUpdate(
        { height: height },
        {
            $setOnInsert: {
                height: height,
                kind: "blockProof" as ProofKind,
                proofs: Array(PROOF_EPOCH_SIZE).fill(null),
                status: Array((PROOF_EPOCH_SIZE - 1) / 2).fill(
                    "waiting" as ProofStatus,
                ),
                failCount: 0,
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
            },
            $set: {
                [`proofs.${height % BLOCK_EPOCH_SIZE}`]: proofId,
            },
        },
        { upsert: true, new: true },
    );

    logger.info(
        `Created proof epoch for first height ${height} with proof for block ${height}`,
    );

    return result;
}
