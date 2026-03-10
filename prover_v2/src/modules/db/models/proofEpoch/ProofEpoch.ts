import mongoose, { Schema, Document, Types } from "mongoose";
import { ProofKind, ProofStatus } from "../../types.js";

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

export const ProofEpochModel = mongoose.model<IProofEpoch>(
    "ProofEpoch",
    ProofEpochSchema,
);
