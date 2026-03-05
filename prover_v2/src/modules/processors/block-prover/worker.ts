import {
    ProofEpochModel,
    fetchBlockRange,
    storeProof,
} from "../../db/index.js";
import {
    BLOCK_EPOCH_SIZE,
    PROOF_EPOCH_LEAF_COUNT,
} from "../../utils/constants.js";
import logger from "../../../logger.js";
import { BlockProverJob } from "../utils/jobs.js";
import { tryEnqueueAggregation } from "../triggers.js";
import {
    GeneratePulsarBlock,
    GenerateSettlementProof,
    SignaturePublicKeyList,
} from "pulsar-contracts";
import { Field, PublicKey, Signature } from "o1js";

export async function worker(task: BlockProverJob) {
    const blockEpochHeight = task.height;
    const leafIndex =
        (blockEpochHeight / BLOCK_EPOCH_SIZE) % PROOF_EPOCH_LEAF_COUNT;

    // Idempotency: skip if leaf proof already exists
    const existing = await ProofEpochModel.findOne({
        height: blockEpochHeight,
    });
    if (existing?.proofs[leafIndex]) {
        logger.info(
            `Block proof for epoch ${blockEpochHeight} already exists at leaf ${leafIndex}, skipping`,
        );
        // Still trigger next stage in case it was missed
        await tryEnqueueAggregation(existing, leafIndex);
        return;
    }

    const proofId = await createProof(blockEpochHeight);

    const proofEpoch = await ProofEpochModel.findOneAndUpdate(
        { height: blockEpochHeight },
        {
            $setOnInsert: {
                height: blockEpochHeight,
                proofs: Array(PROOF_EPOCH_LEAF_COUNT * 2 - 1).fill(null),
                settled: false,
            },
            $set: {
                [`proofs.${leafIndex}`]: proofId,
            },
        },
        { upsert: true, new: true },
    );

    logger.info(
        `Stored block proof for epoch ${blockEpochHeight} at leaf index ${leafIndex}`,
    );

    await tryEnqueueAggregation(proofEpoch, leafIndex);
}

async function createProof(height: number) {
    const rangeLow = height;
    const rangeHigh = height + BLOCK_EPOCH_SIZE - 1;

    const blockDocs = await fetchBlockRange(rangeLow, rangeHigh);

    if (blockDocs.length !== BLOCK_EPOCH_SIZE) {
        throw new Error(
            `Expected ${BLOCK_EPOCH_SIZE} blocks for proof starting at height ${height}, but got ${blockDocs.length}`,
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
