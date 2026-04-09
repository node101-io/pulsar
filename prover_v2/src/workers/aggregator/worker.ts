import {
    type IProofEpoch,
    ProofEpochModel,
} from "../../db/models/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/Proof.js";
import { ProofKind, ProofStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { Aggregation } from "./master.js";
import { PROOF_EPOCH_LEAF_COUNT } from "../../config/constants.js";
import { MergeSettlementProofs, SettlementProof } from "pulsar-contracts";

export async function worker(task: IProofEpoch, aggregation: Aggregation) {
    if (task.failCount > 0 && task.status[aggregation.index] === "done") {
        logger.info(
            `Skipping aggregation for epoch ${task.height}, index ${aggregation.index} because it is already done.`,
        );
        return;
    }

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
