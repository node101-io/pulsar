import mongoose, { Schema, Document, Types } from "mongoose";
import { BlockStatus } from "../../types.js";
import { PROOF_EPOCH_SIZE, TIMEOUT_TIME_MS } from "../../../utils/constants.js";

export interface IBlockEpoch extends Document {
    height: number;
    blocks: (Types.ObjectId | null)[];
    status: BlockStatus[];
    timeoutAt: Date;
    failCount: number;
}

const BlockEpochSchema = new Schema<IBlockEpoch>(
    {
        height: { type: Number, required: true, unique: true, index: true },
        blocks: [
            {
                type: Schema.Types.ObjectId,
                ref: "Block",
                default: null,
            },
        ],
        status: [
            {
                type: String,
                enum: ["waiting", "processing", "done", "failed"] as const,
            },
        ],
        timeoutAt: {
            type: Date,
            default: new Date(Date.now() + TIMEOUT_TIME_MS),
        },
        failCount: { type: Number, default: 0 },
    },
    { timestamps: true },
);

export const BlockEpochModel = mongoose.model<IBlockEpoch>(
    "BlockEpoch",
    BlockEpochSchema,
);
