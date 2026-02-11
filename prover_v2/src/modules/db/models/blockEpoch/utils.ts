import { Types } from "mongoose";
import { BlockEpochModel } from "./BlockEpoch.js";
import {
    BLOCK_EPOCH_SIZE,
    WORKER_TIMEOUT_MS,
} from "../../../utils/constants.js";
import { BlockStatus } from "../../types.js";
import logger from "../../../../logger.js";
import { BlockModel } from "../../index.js";

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
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
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
            $set: { timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS) },
        },
    );
}

export async function seedInitialBlocks() {
    const exists = await BlockEpochModel.exists({ height: 0 });
    if (exists) return;

    // Block koleksiyonundaki genesis bloklarını referans al
    const genesisBlock = await BlockModel.findOne({ height: 0 });
    const firstBlock = await BlockModel.findOne({ height: 1 });

    if (!genesisBlock || !firstBlock) {
        throw new Error(
            "Seed initial blocks: required blocks at heights 0 and 1 not found in Block collection.",
        );
    }

    const blocks = [
        genesisBlock._id,
        firstBlock._id,
        ...Array(BLOCK_EPOCH_SIZE - 2).fill(null),
    ];

    const status = [
        "done" as BlockStatus,
        "done" as BlockStatus,
        ...Array(BLOCK_EPOCH_SIZE - 2).fill("done" as BlockStatus),
    ];

    await BlockEpochModel.create({
        height: 0,
        blocks,
        status,
    });

    logger.info("Seeded initial blocks (height 0 and 1).");
}
