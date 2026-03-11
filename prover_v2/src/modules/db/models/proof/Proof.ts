import mongoose, { Schema, Document } from "mongoose";
import { PROOF_TTL_SECONDS } from "../../../utils/constants.js";

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
