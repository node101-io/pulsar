import { Types } from "mongoose";

import { PROOF_EPOCH_LEAF_COUNT, PROOF_EPOCH_SETTLEMENT_INDEX } from "../utils/constants.js";
import { aggregatorQ, settlerQ } from "./utils/queue.js";
import { DEFAULT_JOB_OPTIONS, aggregatorJobId, settlerJobId } from "./utils/jobOptions.js";
import type { IProofEpoch } from "../db/index.js";
import logger from "../../logger.js";

/**
 * After a proof is stored at `completedIndex` in the ProofEpoch,
 * check if its sibling also exists. If so, enqueue the aggregation job
 * that merges them into the parent node.
 *
 * Works for both leaf proofs (indices 0..LEAF_COUNT-1) and
 * internal aggregated proofs (indices LEAF_COUNT..SETTLEMENT_INDEX-1).
 */
export async function tryEnqueueAggregation(
    proofEpoch: IProofEpoch,
    completedIndex: number,
): Promise<void> {
    const siblingIndex =
        completedIndex % 2 === 0 ? completedIndex + 1 : completedIndex - 1;

    if (!proofEpoch.proofs[siblingIndex]) {
        return;
    }

    const parentProofIndex =
        PROOF_EPOCH_LEAF_COUNT + Math.floor(completedIndex / 2);

    if (parentProofIndex > PROOF_EPOCH_SETTLEMENT_INDEX) {
        return;
    }

    const aggregationIndex = parentProofIndex - PROOF_EPOCH_LEAF_COUNT;

    const leftIndex = Math.min(completedIndex, siblingIndex);
    const rightIndex = Math.max(completedIndex, siblingIndex);

    const leftId = proofEpoch.proofs[leftIndex] as Types.ObjectId;
    const rightId = proofEpoch.proofs[rightIndex] as Types.ObjectId;

    await aggregatorQ.add(
        "aggregator",
        {
            height: proofEpoch.height,
            index: aggregationIndex,
            left: leftId.toString(),
            right: rightId.toString(),
        },
        {
            jobId: aggregatorJobId(proofEpoch.height, aggregationIndex),
            ...DEFAULT_JOB_OPTIONS,
        },
    );

    logger.debug(
        `Enqueued aggregation job for epoch ${proofEpoch.height}, index ${aggregationIndex}`,
        {
            epochHeight: proofEpoch.height,
            aggregationIndex,
            event: "aggregation_triggered",
        },
    );
}

/**
 * After the root proof is produced (at PROOF_EPOCH_SETTLEMENT_INDEX),
 * enqueue the settler job to submit it on-chain.
 */
export async function tryEnqueueSettlement(
    proofEpoch: IProofEpoch,
): Promise<void> {
    const rootProofId = proofEpoch.proofs[PROOF_EPOCH_SETTLEMENT_INDEX];

    if (!rootProofId || proofEpoch.settled) {
        return;
    }

    await settlerQ.add(
        "settler",
        {
            height: proofEpoch.height,
            settlementProofId: rootProofId.toString(),
        },
        {
            jobId: settlerJobId(proofEpoch.height),
            ...DEFAULT_JOB_OPTIONS,
        },
    );

    logger.debug(
        `Enqueued settler job for epoch ${proofEpoch.height}`,
        {
            epochHeight: proofEpoch.height,
            event: "settlement_triggered",
        },
    );
}
