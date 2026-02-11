import {
    type IProofEpoch,
    ProofEpochModel,
} from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/proof/utils.js";
import { ProofKind, ProofStatus } from "../../db/types.js";
import logger from "../../../logger.js";
import { Aggregation } from "./master.js";
import { PROOF_EPOCH_LEAF_COUNT } from "../../utils/constants.js";
import { MergeSettlementProofs, SettlementProof } from "pulsar-contracts";

export async function worker(task: IProofEpoch, aggregation: Aggregation) {
    // register aggregation proof in db
    await registerAggregatedProofSlot(task, aggregation.index);

    const leftProofJson = await getProof(aggregation.left);
    const rightProofJson = await getProof(aggregation.right);

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

    await ProofEpochModel.findOneAndUpdate(
        { height: task.height },
        {
            $set: {
                [`proofs.${PROOF_EPOCH_LEAF_COUNT + aggregation.index}`]:
                    aggregatedProofId,
                [`status.${aggregation.index}`]: "done" as ProofStatus,
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${task.height} stored in slot ${PROOF_EPOCH_LEAF_COUNT + aggregation.index}.`,
        {
            aggregatedProofId: aggregatedProofId.toHexString(),
            index: PROOF_EPOCH_LEAF_COUNT + aggregation.index,
            event: "aggregated_proof_stored",
        },
    );
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

async function registerAggregatedProofSlot(task: IProofEpoch, index: number) {
    const result = await ProofEpochModel.updateOne(
        {
            height: task.height,
            [`status.${index}`]: { $ne: "processing" as ProofStatus },
        },
        {
            $set: {
                kind: "aggregation" as ProofKind,
                [`status.${index}`]: "processing" as ProofStatus,
            },
        },
    );

    if (!result.matchedCount) {
        throw new Error(
            `Failed to register aggregated proof slot for epoch at height ${task.height}.`,
        );
    }
}
