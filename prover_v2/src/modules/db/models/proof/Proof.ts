import mongoose, { Schema, Document } from "mongoose";

export interface IProof extends Document {
    data: string;
}

const ProofSchema = new Schema<IProof>(
    {
        data: { type: String, required: true },
    },
    { timestamps: true },
);

export const ProofModel = mongoose.model<IProof>("Proof", ProofSchema);
