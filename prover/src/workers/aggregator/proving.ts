import { Types } from "mongoose";
import { Cache } from "o1js";
import type { JsonProof } from "o1js";
import {
    MergeSettlementProofs,
    SettlementProof,
    MultisigVerifierProgram,
} from "pulsar-contracts";

import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/Proof.js";
import { ProofStatus } from "../../common/types.js";
import { PROOF_EPOCH_LEAF_COUNT, CACHE_DIR } from "../../config/constants.js";
import logger from "../../common/logger.js";

// Child-process side. See workers/childProver.ts.

let compiled = false;
export async function ensureCompiled() {
    if (compiled) return;
    await MultisigVerifierProgram.compile({
        cache: Cache.FileSystem(CACHE_DIR),
    });
    compiled = true;
}

/**
 * Merge one pair of proofs and store the result in its slot — the whole unit
 * of work, so the parent only has to read an exit code. The multi-MB proof
 * JSON never enters the master's heap.
 */
export async function proveAggregation(
    height: number,
    left: Types.ObjectId,
    right: Types.ObjectId,
    index: number,
): Promise<void> {
    const leftProofJson = await getProof(left);
    const rightProofJson = await getProof(right);

    if (!leftProofJson || !rightProofJson) {
        throw new Error("One of the proofs to aggregate is missing.");
    }

    const aggregatedProofJson = await generateAggregatedProof(
        leftProofJson,
        rightProofJson,
    );

    const aggregatedProofId = await storeProof(aggregatedProofJson);

    if (!aggregatedProofId) {
        throw new Error("Failed to store aggregated proof.");
    }

    const proofSlotIndex = PROOF_EPOCH_LEAF_COUNT + index;

    await ProofEpochModel.findOneAndUpdate(
        { height },
        {
            $set: {
                [`proofs.${proofSlotIndex}`]: aggregatedProofId,
                [`status.${index}`]: "done" as ProofStatus,
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${height} stored in slot ${proofSlotIndex}.`,
        {
            aggregatedProofId: aggregatedProofId.toHexString(),
            index: proofSlotIndex,
            event: "aggregated_proof_stored",
        },
    );
}

async function generateAggregatedProof(
    leftJson: JsonProof,
    rightJson: JsonProof,
): Promise<string> {
    const left = await SettlementProof.fromJSON(leftJson);
    const right = await SettlementProof.fromJSON(rightJson);

    const merged = await MergeSettlementProofs([left, right]);

    return JSON.stringify(merged.toJSON());
}
