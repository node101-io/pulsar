import mongoose, { Schema, Document } from "mongoose";
import {
    VoteExt,
    ValidatorInfo,
    BlockData,
    BlockStatus,
} from "../../common/types.js";
import { ANCHOR_BLOCK_HEIGHT } from "../../config/constants.js";
import logger from "../../common/logger.js";

export interface IBlock extends Document {
    height: number;
    status: BlockStatus;
    stateRoot: string;
    validators: ValidatorInfo[];
    validatorListHash: string;
    actionsReducedRoot: string;
    voteExt: VoteExt[];
}

const VoteExtSchema = new Schema<VoteExt>(
    {
        validatorAddr: { type: String, required: true },
        signature: { type: String, required: true },
    },
    { _id: false },
);

const ValidatorInfoSchema = new Schema<ValidatorInfo>(
    {
        addr: { type: String, required: true },
        power: { type: String, required: true },
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
        validators: [ValidatorInfoSchema],
        validatorListHash: { type: String, required: true },
        actionsReducedRoot: { type: String, required: true, default: "0" },
        voteExt: [VoteExtSchema],
    },
    { timestamps: true },
);

// Pruning lives in the settler worker: it deletes an epoch's blocks once that
// epoch is settled on Mina. Do not add a document middleware here — every write
// goes through findOneAndUpdate, which does not fire document hooks.
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
            $setOnInsert: { status: "waiting" },
        },
        { upsert: true, returnDocument: "after" },
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

export interface AnchorBlock {
    validatorListHash: string;
    stateRoot: string;
    height: number;
}

/**
 * The block the first settlement proof starts from, and therefore the
 * SettlementContract's initial state.
 *
 * All three fields must come from this one record: `settle` requires the
 * contract's merkleListRoot, stateRoot and blockHeight to equal the proof's
 * Initial* values. Sourcing any of them separately — from a different block, an
 * env override, or a default — produces a contract that deploys cleanly and
 * then rejects every settlement with an opaque precondition failure. So this
 * reads one document and refuses to guess.
 */
export async function fetchAnchorBlock(): Promise<AnchorBlock> {
    const block = await BlockModel.findOne({ height: ANCHOR_BLOCK_HEIGHT });

    if (!block?.validatorListHash || block.stateRoot === undefined) {
        throw new Error(
            `Anchor block ${ANCHOR_BLOCK_HEIGHT} is missing or incomplete in MongoDB. ` +
                "Run `pnpm run seed` against the target chain first.",
        );
    }

    return {
        validatorListHash: String(block.validatorListHash),
        stateRoot: String(block.stateRoot),
        height: Number(block.height),
    };
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
