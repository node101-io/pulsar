import mongoose, { Schema, Document } from "mongoose";
import { VoteExt, BlockData, BlockStatus } from "../../common/types.js";
import { BLOCKS_TO_KEEP, WORKER_TIMEOUT_MS } from "../../config/constants.js";
import logger from "../../common/logger.js";

export interface IBlock extends Document {
    height: number;
    status: BlockStatus;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    actionsReducedRoot: string;
    voteExt: VoteExt[];
    timeoutAt?: Date;
}

const VoteExtSchema = new Schema<VoteExt>(
    {
        index: { type: String, required: true },
        height: { type: Number, required: true },
        validatorAddr: { type: String, required: true },
        signature: { type: String, required: true },
    },
    { _id: false },
);

const BlockSchema = new Schema<IBlock>(
    {
        height: { type: Number, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ["waiting", "processing", "done", "failed"],
            default: "waiting",
        },
        stateRoot: { type: String, required: true },
        validators: [{ type: String }],
        validatorListHash: { type: String, required: true },
        actionsReducedRoot: { type: String, required: true, default: "0" },
        voteExt: [VoteExtSchema],
        timeoutAt: { type: Date },
    },
    { timestamps: true },
);

BlockSchema.post("save", async function () {
    const Model = this.constructor as typeof BlockModel;
    const count = await Model.countDocuments();
    if (count > BLOCKS_TO_KEEP) {
        const cutoff = await Model.findOne({})
            .sort({ height: -1 })
            .skip(BLOCKS_TO_KEEP - 1)
            .select("height")
            .lean(); // lean function returns a plain JavaScript object instead of a Mongoose document
        if (cutoff) {
            await Model.deleteMany({ height: { $lt: cutoff.height } });
        }
    }
});

export const BlockModel = mongoose.model<IBlock>("Block", BlockSchema);

// Utils

export async function storeBlock(block: BlockData) {
    const result = await BlockModel.findOneAndUpdate(
        { height: block.height },
        {
            $set: {
                stateRoot: block.stateRoot,
                validators: block.validators,
                validatorListHash: block.validatorListHash,
                actionsReducedRoot: block.actionsReducedRoot,
                voteExt: block.voteExt,
            },
            $setOnInsert: {
                status: "waiting",
                timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS),
            },
        },
        { upsert: true, new: true },
    );

    logger.info(`Stored block at height ${block.height}.`);
    return result!;
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
