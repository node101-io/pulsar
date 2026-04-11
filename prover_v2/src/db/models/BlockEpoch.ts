import mongoose, { Schema, Document, Types } from "mongoose";
import {
    BLOCK_EPOCH_SIZE,
    PROOF_TTL_SECONDS,
    WORKER_TIMEOUT_MS,
} from "../../config/constants.js";
import { BlockStatus } from "../../common/types.js";
import logger from "../../common/logger.js";

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

BlockEpochSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: PROOF_TTL_SECONDS },
);

export const BlockEpochModel = mongoose.model<IBlockEpoch>(
    "BlockEpoch",
    BlockEpochSchema,
);

// Utils

export async function getBlockEpoch(height: number) {
    return BlockEpochModel.findOne({ height });
}

export async function storeBlockInBlockEpoch(
    height: number,
    blockId: Types.ObjectId,
    index: number,
) {
    if (index < 0 || index >= BLOCK_EPOCH_SIZE) {
        throw new Error(`Index must be between 0 and ${BLOCK_EPOCH_SIZE - 1}`);
    }

    // Epochs start at height 1 (block 0 is genesis context, not provable)
    const blockEpochHeight =
        Math.floor((height - 1) / BLOCK_EPOCH_SIZE) * BLOCK_EPOCH_SIZE + 1;

    await BlockEpochModel.updateOne(
        { height: blockEpochHeight },
        {
            $setOnInsert: {
                height: blockEpochHeight,
                blocks: Array(BLOCK_EPOCH_SIZE).fill(null),
                status: Array(BLOCK_EPOCH_SIZE).fill("waiting" as BlockStatus),
                failCount: 0,
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
            },
        },
        { upsert: true },
    );

    const result = await BlockEpochModel.findOneAndUpdate(
        { height: blockEpochHeight },
        {
            $set: {
                [`blocks.${index}`]: blockId,
            },
        },
        { new: true },
    );

    logger.info(
        `Stored block ${blockId.toHexString()} in block epoch at height ${blockEpochHeight} for index ${index}.`,
    );

    return result;
}

export async function updateBlockStatusInEpoch(
    blockEpochHeight: number,
    index: number,
    status: BlockStatus,
) {
    if (index < 0 || index >= BLOCK_EPOCH_SIZE) {
        throw new Error(`Index must be between 0 and ${BLOCK_EPOCH_SIZE - 1}`);
    }

    await BlockEpochModel.findOneAndUpdate(
        { height: blockEpochHeight },
        {
            $set: {
                [`status.${index}`]: status,
            },
        },
    );

    logger.info(
        `Updated block status in epoch ${blockEpochHeight} at index ${index} to ${status}.`,
    );
}

export async function deleteBlockEpoch(height: number) {
    await BlockEpochModel.deleteOne({ height });

    logger.info(`Deleted block epoch at height ${height}.`);
}

export async function incrementBlockEpochFailCount(height: number) {
    await BlockEpochModel.updateOne(
        { height },
        {
            $inc: { failCount: 1 },
            $set: { timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS) },
        },
    );
}
