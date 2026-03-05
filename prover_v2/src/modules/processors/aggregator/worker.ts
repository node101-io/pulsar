import { Types } from "mongoose";

import { ProofEpochModel } from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/proof/utils.js";
import logger from "../../../logger.js";
import {
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SETTLEMENT_INDEX,
} from "../../utils/constants.js";
import { AggregatorJob } from "../utils/jobs.js";
import { tryEnqueueAggregation, tryEnqueueSettlement } from "../triggers.js";
import { MergeSettlementProofs, SettlementProof } from "pulsar-contracts";

export async function worker(task: AggregatorJob) {
    const { height, index, left, right } = task;
    const parentProofIndex = PROOF_EPOCH_LEAF_COUNT + index;

    // Idempotency: skip if this aggregation is already done
    const proofEpoch = await ProofEpochModel.findOne({ height });
    if (!proofEpoch) {
        throw new Error(`ProofEpoch at height ${height} not found.`);
    }

    if (proofEpoch.proofs[parentProofIndex]) {
        logger.info(
            `Aggregation ${index} for epoch ${height} already done, skipping`,
        );
        // Still trigger next stage in case it was missed
        if (parentProofIndex === PROOF_EPOCH_SETTLEMENT_INDEX) {
            await tryEnqueueSettlement(proofEpoch);
        } else {
            await tryEnqueueAggregation(proofEpoch, parentProofIndex);
        }
        return;
    }

    const leftProofJson = await getProof(new Types.ObjectId(left));
    const rightProofJson = await getProof(new Types.ObjectId(right));

    if (!leftProofJson || !rightProofJson) {
        throw new Error("One of the proofs to aggregate is missing.");
    }

    const aggregatedProofJson = await generateAggregatedProof(
        leftProofJson,
        rightProofJson,
    );

    const aggregatedProofId = await storeProof(aggregatedProofJson);

    const updatedEpoch = await ProofEpochModel.findOneAndUpdate(
        { height },
        {
            $set: {
                [`proofs.${parentProofIndex}`]: aggregatedProofId,
            },
        },
        { new: true },
    );

    logger.info(
        `Aggregated proof for epoch ${height} stored in slot ${parentProofIndex}`,
        {
            aggregatedProofId: aggregatedProofId.toHexString(),
            index: parentProofIndex,
            event: "aggregated_proof_stored",
        },
    );

    if (!updatedEpoch) return;

    // Trigger next stage
    if (parentProofIndex === PROOF_EPOCH_SETTLEMENT_INDEX) {
        await tryEnqueueSettlement(updatedEpoch);
    } else {
        await tryEnqueueAggregation(updatedEpoch, parentProofIndex);
    }
}

async function generateAggregatedProof(
    leftJson: any,
    rightJson: any,
): Promise<string> {
    const left = await SettlementProof.fromJSON(leftJson);
    const right = await SettlementProof.fromJSON(rightJson);

    const merged = await MergeSettlementProofs([left, right]);

    return JSON.stringify(merged.toJSON());
}
