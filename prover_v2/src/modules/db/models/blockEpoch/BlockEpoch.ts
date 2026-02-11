import mongoose, { Schema, Document, Types } from "mongoose";
import {
    BLOCK_EPOCH_SIZE,
    WORKER_TIMEOUT_MS,
} from "../../../utils/constants.js";
import { BlockStatus } from "../../types.js";

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
        status: {
            type: [String],
            enum: ["waiting", "processing", "done", "failed"],
            default: Array(BLOCK_EPOCH_SIZE).fill("waiting" as BlockStatus),
        },
        timeoutAt: {
            type: Date,
            default: new Date(Date.now() + WORKER_TIMEOUT_MS),
        },
        failCount: { type: Number, default: 0 },
    },
    { timestamps: true },
);

export const BlockEpochModel = mongoose.model<IBlockEpoch>(
    "BlockEpoch",
    BlockEpochSchema,
);
