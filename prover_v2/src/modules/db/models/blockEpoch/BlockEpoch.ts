import mongoose, { Schema, Document, Types } from "mongoose";
import {
    BLOCK_EPOCH_SIZE,
    PROOF_TTL_SECONDS,
    WORKER_TIMEOUT_MS,
} from "../../../utils/constants.js";
import { BlockStatus } from "../../types.js";

export interface IBlockEpoch extends Document {
    height: number;
    blocks: (Types.ObjectId | null)[];
    status: BlockStatus[];
    epochStatus: BlockStatus;
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
        status: {
            type: [String],
            enum: ["waiting", "processing", "done", "failed"],
            default: Array(BLOCK_EPOCH_SIZE).fill("waiting" as BlockStatus),
        },
        epochStatus: {
            type: String,
            enum: ["waiting", "processing", "done", "failed"],
            default: "waiting" as BlockStatus,
        },
        timeoutAt: {
            type: Date,
            default: new Date(Date.now() + WORKER_TIMEOUT_MS),
        },
        failCount: { type: Number, default: 0 },
    },
    { timestamps: true },
);

BlockEpochSchema.index({ createdAt: 1 }, { expireAfterSeconds: PROOF_TTL_SECONDS });

export const BlockEpochModel = mongoose.model<IBlockEpoch>(
    "BlockEpoch",
    BlockEpochSchema,
);
