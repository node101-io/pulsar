import mongoose, { Schema, Document, Types } from "mongoose";
import { PROOF_TTL_SECONDS } from "../../config/constants.js";
import logger from "../../common/logger.js";

export interface IProof extends Document {
    data: string;
}

const ProofSchema = new Schema<IProof>(
    {
        data: { type: String, required: true },
    },
    { timestamps: true },
);

ProofSchema.index({ createdAt: 1 }, { expireAfterSeconds: PROOF_TTL_SECONDS });

export const ProofModel = mongoose.model<IProof>("Proof", ProofSchema);

// Utils

export async function storeProof(data: string): Promise<Types.ObjectId> {
    const doc = await ProofModel.create({ data });

    logger.info(`Stored proof with id ${doc._id.toHexString()}.`);
    return doc._id as Types.ObjectId;
}

export async function getProof(id: Types.ObjectId) {
    const proof = await ProofModel.findById(id);

    if (!proof || !proof.data) throw new Error("Proof not found");

    logger.info(`Retrieved proof with id ${id.toHexString()}.`);
    return JSON.parse(proof.data);
}

export async function deleteProof(id: Types.ObjectId) {
    await ProofModel.deleteOne({ _id: id });

    logger.info(`Deleted proof with id ${id.toHexString()}.`);
}
