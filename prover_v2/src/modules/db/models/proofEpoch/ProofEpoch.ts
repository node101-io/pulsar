import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProofEpoch extends Document {
    height: number;
    proofs: (Types.ObjectId | null)[];
    settled: boolean;
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
        settled: { type: Boolean, default: false },
    },
    { timestamps: true },
);

export const ProofEpochModel = mongoose.model<IProofEpoch>(
    "ProofEpoch",
    ProofEpochSchema,
);
