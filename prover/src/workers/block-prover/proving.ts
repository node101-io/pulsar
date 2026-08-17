import { Types } from "mongoose";
import { Cache, Field, PublicKey, Signature } from "o1js";
import {
    GeneratePulsarBlock,
    GenerateSettlementProof,
    SignaturePublicKeyList,
    MultisigVerifierProgram,
} from "pulsar-contracts";

import {
    ProofEpochModel,
    BlockEpochModel,
    storeProof,
    fetchBlockRange,
} from "../../db/index.js";
import {
    BLOCK_EPOCH_SIZE,
    PROOF_EPOCH_LEAF_COUNT,
    CACHE_DIR,
} from "../../config/constants.js";
import { BlockStatus, ProofKind, ProofStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { proofEpochHeightFor, leafIndexFor } from "./helpers.js";

// Child-process side. See workers/childProver.ts.

// Well-formed but non-verifying signature (r=s=1) for non-signing validators.
const DUMMY_SIGNATURE = Signature.fromValue({ r: 1n, s: 1n });

let compiled = false;
export async function ensureCompiled() {
    if (compiled) return;
    await MultisigVerifierProgram.compile({
        cache: Cache.FileSystem(CACHE_DIR),
    });
    compiled = true;
}

/**
 * Prove block epoch `height`, store the leaf in its proof epoch and mark the
 * block epoch done — the whole unit of work, so the parent only has to read an
 * exit code. Each step is idempotent on re-entry: a leaf already present is
 * detected by the parent before the child is ever spawned, and the reconciling
 * sweep re-queues a done epoch whose leaf is missing.
 */
export async function proveBlockEpoch(height: number): Promise<void> {
    const proofId = await createProof(height);
    await storeProofInEpoch(height, proofId);

    await BlockEpochModel.findOneAndUpdate(
        { height },
        { $set: { epochStatus: "done" as BlockStatus } },
    );

    logger.info(
        `Settlement proof generated for epoch ${height}, epoch marked done`,
        {
            epochHeight: height,
            proofId: proofId.toHexString(),
            event: "epoch_proof_done",
        },
    );
}

export async function createProof(height: number) {
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
            Field.from(cur.actionsReducedRoot ?? "0"),
        );
        blocks.push(block);

        // prev.validators is the FULL validator set in the chain's fold order
        // (power ASC, consAddr ASC). Pair each validator with its signature and
        // power to rebuild the exact leaf list + power-weighted quorum the
        // circuit checks. A validator that did not sign gets a dummy signature
        // (fails verify → excluded from accumulatedPower) but still contributes
        // power + its merkle leaf, so we must NOT drop it or throw.
        const voteExtByAddr = new Map(
            cur.voteExt.map((ext) => [ext.validatorAddr, ext]),
        );

        const sigList = SignaturePublicKeyList.fromArray(
            prev.validators.map(({ addr, power }) => {
                const ext = voteExtByAddr.get(addr);
                return [
                    ext
                        ? Signature.fromBase58(ext.signature)
                        : DUMMY_SIGNATURE,
                    PublicKey.fromBase58(addr),
                    Field(power),
                ];
            }),
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
async function storeProofInEpoch(
    blockEpochHeight: number,
    proofId: Types.ObjectId,
) {
    const proofEpochHeight = proofEpochHeightFor(blockEpochHeight);
    const leafIndex = leafIndexFor(blockEpochHeight);

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
            },
        },
        { upsert: true },
    );

    const result = await ProofEpochModel.findOneAndUpdate(
        { height: proofEpochHeight },
        { $set: { [`proofs.${leafIndex}`]: proofId } },
        { returnDocument: "after" },
    );

    logger.info(
        `Stored block proof in proof epoch at height ${proofEpochHeight}, leaf index ${leafIndex}`,
    );

    return result;
}
