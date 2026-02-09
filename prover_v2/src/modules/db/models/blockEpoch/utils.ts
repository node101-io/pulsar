import { Types } from "mongoose";
import { BlockEpochModel } from "./BlockEpoch.js";
import { BLOCK_EPOCH_SIZE, TIMEOUT_TIME_MS } from "../../../utils/constants.js";
import { BlockStatus } from "../../types.js";
import logger from "../../../../logger.js";

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

    const blockEpochHeight =
        Math.floor(height / BLOCK_EPOCH_SIZE) * BLOCK_EPOCH_SIZE;

    const result = await BlockEpochModel.findOneAndUpdate(
        { height: blockEpochHeight },
        {
            $setOnInsert: {
                height: blockEpochHeight,
                blocks: Array(BLOCK_EPOCH_SIZE).fill(null),
                status: Array(BLOCK_EPOCH_SIZE).fill("waiting" as BlockStatus),
                failCount: 0,
                timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS),
            },
            $set: {
                [`blocks.${index}`]: blockId,
            },
        },
        { upsert: true, new: true },
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
            $set: { timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS) },
        },
    );
}
