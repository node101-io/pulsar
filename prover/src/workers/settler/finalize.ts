import logger from "../../common/logger.js";
import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import { BlockModel } from "../../db/models/Block.js";
import { ProofModel } from "../../db/models/Proof.js";
import { ProofKind } from "../../common/types.js";
import { PROOF_EPOCH_SIZE } from "../../config/constants.js";

/**
 * Marks a settled proof epoch as done and reclaims its storage: the epoch's
 * blocks, its proof documents and the proved tx JSON. Idempotent — the settler
 * master's confirm loop and the worker's pre-settled path may both reach it.
 *
 * Settled proofs are dead weight; the TTL index stays only as the safety net
 * for epochs that never reach this point.
 */
export async function finalizeSettledEpoch(height: number): Promise<void> {
    const epoch = await ProofEpochModel.findOneAndUpdate(
        { height, kind: { $ne: "done" as ProofKind } },
        {
            $set: {
                kind: "done" as ProofKind,
                sentTxHash: null,
                sentNonce: null,
                sentAt: null,
            },
        },
        { returnDocument: "before" },
    );
    if (!epoch) return; // already finalized

    logger.info("Proof epoch settled and finalized", {
        epochHeight: height,
        event: "settler_epoch_done",
    });

    const deleted = await BlockModel.deleteMany({
        height: { $gte: height, $lt: height + PROOF_EPOCH_SIZE },
    });

    logger.info(
        `Deleted ${deleted.deletedCount} proved blocks for epoch at height ${height}`,
        {
            epochHeight: height,
            deletedCount: deleted.deletedCount,
            event: "settler_blocks_deleted",
        },
    );

    const proofIds = (epoch.proofs ?? []).filter((id) => id !== null);
    const prunedProofs =
        proofIds.length > 0
            ? await ProofModel.deleteMany({ _id: { $in: proofIds } })
            : { deletedCount: 0 };

    await ProofEpochModel.updateOne(
        { height },
        { $set: { proofs: [], provedTxJson: null } },
    );

    logger.info(
        `Pruned ${prunedProofs.deletedCount} proofs for settled epoch at height ${height}`,
        {
            epochHeight: height,
            deletedCount: prunedProofs.deletedCount,
            event: "settler_proofs_pruned",
        },
    );
}
