import {
    type IProofEpoch,
    ProofEpochModel,
} from "../../db/models/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/Proof.js";
import { ProofStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { Aggregation } from "./master.js";
import { PROOF_EPOCH_LEAF_COUNT, PROOF_EPOCH_SETTLEMENT_INDEX, WORKER_TIMEOUT_MS } from "../../config/constants.js";
import { MergeSettlementProofs, SettlementProof, MultisigVerifierProgram } from "pulsar-contracts";

let compiled = false;
async function ensureCompiled() {
    if (!compiled) {
        await MultisigVerifierProgram.compile();
        compiled = true;
    }
}

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

    await ensureCompiled();

    const aggregatedProofJson = await generateAggregatedProof(
        leftProofJson,
        rightProofJson,
    );

    const aggregatedProofId = await storeProof(aggregatedProofJson);

    if (!aggregatedProofId) {
        throw new Error("Failed to store aggregated proof.");
    }

    const proofSlotIndex = PROOF_EPOCH_LEAF_COUNT + aggregation.index;
    const isRootProof = proofSlotIndex === PROOF_EPOCH_SETTLEMENT_INDEX;

    await ProofEpochModel.findOneAndUpdate(
        { height: task.height },
        {
            $set: {
                [`proofs.${proofSlotIndex}`]: aggregatedProofId,
                [`status.${aggregation.index}`]: "done" as ProofStatus,
                // Refresh the timeout when the root proof is ready so the
                // settlement-prover's timeoutAt filter doesn't skip this epoch
                ...(isRootProof && { timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS) }),
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${task.height} stored in slot ${proofSlotIndex}.`,
        {
            aggregatedProofId: aggregatedProofId.toHexString(),
            index: proofSlotIndex,
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
