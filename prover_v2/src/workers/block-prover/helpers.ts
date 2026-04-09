import { BlockStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { BlockEpochModel } from "../../db/models/BlockEpoch.js";

async function registerBlock(blockEpochHeight: number, index: number) {
    const result = await BlockEpochModel.updateOne(
        {
            height: blockEpochHeight,
            [`status.${index}`]: "waiting" as BlockStatus,
        },
        { $set: { [`status.${index}`]: "processing" as BlockStatus } },
    );

    if (!result.matchedCount) {
        throw new Error(
            `Block at index ${index} in epoch ${blockEpochHeight} is not in 'waiting' status.`,
        );
    }

    logger.info(
        `Registered block at index ${index} in epoch ${blockEpochHeight} as 'processing'.`,
    );
}

export { registerBlock };
