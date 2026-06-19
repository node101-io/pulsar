import mongoose, { Schema, Document, Types } from "mongoose";
import { ProofKind, ProofStatus } from "../../common/types.js";
import { PROOF_TTL_SECONDS, PROOF_EPOCH_LEAF_COUNT, PROOF_EPOCH_SETTLEMENT_INDEX, WORKER_TIMEOUT_MS } from "../../config/constants.js";
import logger from "../../common/logger.js";

export interface IProofEpoch extends Document {
    height: number;
    proofs: (Types.ObjectId | null)[];
    status: ProofStatus[];
    timeoutAt: Date;
    kind: ProofKind;
    failCount: number;
    provedTxJson: string | null;
}

const ProofEpochSchema = new Schema<IProofEpoch>(
    {
        height: { type: Number, required: true, unique: true, index: true },
        proofs: [
            {
                type: Schema.Types.ObjectId,
                ref: "Proof",
                default: null,
            },
        ],
        status: [
            {
                type: String,
                enum: ["waiting", "processing", "done", "failed"],
            },
        ],
        timeoutAt: { type: Date, required: true },
        kind: {
            type: String,
            enum: ["blockProof", "aggregation", "txProving", "settlement", "txSending", "done"],
            required: true,
        },
        failCount: { type: Number, default: 0 },
        provedTxJson: { type: String, default: null },
    },
    { timestamps: true },
);

ProofEpochSchema.index({ createdAt: 1 }, { expireAfterSeconds: PROOF_TTL_SECONDS });

export const ProofEpochModel = mongoose.model<IProofEpoch>(
    "ProofEpoch",
    ProofEpochSchema,
);

// Utils

export async function getProofEpoch(height: number) {
    return ProofEpochModel.findOne({ height });
}

export async function storeProofInProofEpoch(
    height: number,
    proof: Types.ObjectId,
    index: number,
) {
    if (index < 0 || index > PROOF_EPOCH_SETTLEMENT_INDEX) {
        throw new Error("Index must be between 0 and 31");
    }

    const update: Record<string, any> = {
        [`proofs.${index}`]: proof,
    };

    if (index > PROOF_EPOCH_LEAF_COUNT - 1) {
        update[`status.${index % PROOF_EPOCH_LEAF_COUNT}`] = "done";
    }

    await ProofEpochModel.findOneAndUpdate({ height }, { $set: update });

    logger.info(
        `Stored proof ${proof.toHexString()} in proof epoch at height ${height} for index ${index}.`,
    );
}

export async function deleteProofEpoch(height: number) {
    await ProofEpochModel.deleteOne({ height });

    logger.info(`Deleted proof epoch at height ${height}.`);
}

export async function incrementProofEpochFailCount(height: number) {
    await ProofEpochModel.updateOne(
        { height },
        {
            $inc: { failCount: 1 },
            $set: { timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS) },
        },
    );
}
