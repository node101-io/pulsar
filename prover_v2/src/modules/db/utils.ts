import { DB } from "./db";
import { BlockDoc } from "./interfaces";
import { TIMEOUT_TIME_MS } from "../utils/constants";
import logger from "../../logger";

export async function fetchBlockRange(
    range_low: number,
    range_high: number,
): Promise<BlockDoc[]> {
    const db = new DB();
    await db.initMongo();

    const blocks = await db.blocksCol
        .find({ height: { $gte: range_low, $lte: range_high } })
        .sort({ height: 1 })
        .toArray();

    if (range_low < 0 && blocks.length > 0) {
        blocks.unshift(blocks[0]);
    }

    logger.info(
        `Fetched blocks from height ${range_low} to ${range_high}. Total blocks fetched: ${blocks.length}`,
    );

    return blocks;
}

export async function fetchLastStoredBlock(): Promise<BlockDoc | null> {
    const db = new DB();
    await db.initMongo();

    const block = await db.blocksCol.findOne({}, { sort: { height: -1 } });
    if (!block) {
        logger.warn(`No blocks found in the database.`);
        return null;
    }

    logger.info(`Fetched last stored block at height ${block.height}.`);
    return block;
}

export async function incrementFailCount(blockHeight: number) {
    const db = new DB();
    await db.initMongo();

    await db.proofEpochsCol.updateOne(
        { blockHeight },
        {
            $inc: { failCount: 1 },
            $set: { timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS) },
        },
    );
}
