import { BlockModel, IBlock } from "./Block.js";
import { BlockData } from "../../../utils/interfaces.js";
import { WORKER_TIMEOUT_MS } from "../../../utils/constants.js";
import logger from "../../../../logger.js";

export async function storeBlock(block: BlockData) {
    await BlockModel.updateOne(
        { height: block.height },
        {
            $set: {
                stateRoot: block.stateRoot,
                validators: block.validators,
                validatorListHash: block.validatorListHash,
                voteExt: block.voteExt,
            },
            $setOnInsert: {
                status: "waiting",
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
            },
        },
        { upsert: true },
    );

    logger.info(`Stored block at height ${block.height}.`);
}

export async function getBlock(height: number) {
    return BlockModel.findOne({ height });
}

export async function fetchBlockRange(
    rangeLow: number,
    rangeHigh: number,
): Promise<IBlock[]> {
    const blocks = await BlockModel.find({
        height: { $gte: rangeLow, $lte: rangeHigh },
    }).sort({ height: 1 });

    if (rangeLow < 0 && blocks.length > 0) {
        blocks.unshift(blocks[0]);
    }

    logger.info(
        `Fetched blocks from height ${rangeLow} to ${rangeHigh}. Total: ${blocks.length}`,
    );

    return blocks;
}

export async function fetchLastStoredBlock(): Promise<IBlock | null> {
    const block = await BlockModel.findOne().sort({ height: -1 });

    if (!block) {
        logger.warn("No blocks found in the database.");
        return null;
    }

    logger.info(`Fetched last stored block at height ${block.height}.`);
    return block;
}
