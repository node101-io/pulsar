import { BlockModel, IBlock } from "./Block.js";
import { BlockData } from "../../../utils/interfaces.js";
import { TIMEOUT_TIME_MS } from "../../../utils/constants.js";
import logger from "../../../../logger.js";
import { Signature } from "o1js";

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
                timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS),
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

export async function seedInitialBlocks() {
    const exists = await BlockModel.exists({ height: 0 });
    if (exists) return;

    await BlockModel.create({
        height: 0,
        status: "done",
        stateRoot: BigInt(
            "0x" +
                Buffer.from(
                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                    "base64",
                ).toString("hex"),
        ).toString(),
        validators: ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
        validatorListHash:
            "6310558633462665370159457076080992493592463962672742685757201873330974620505",
        voteExt: [],
    });

    await BlockModel.create({
        height: 1,
        status: "done",
        stateRoot: BigInt(
            "0x" +
                Buffer.from(
                    "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
                    "base64",
                ).toString("hex"),
        ).toString(),
        validators: ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
        validatorListHash:
            "6310558633462665370159457076080992493592463962672742685757201873330974620505",
        voteExt: [
            {
                index: "0",
                height: 1,
                validatorAddr:
                    "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                signature: Signature.fromValue({
                    r: 1252644915096851551329970336594686639171015300754931693803244151631871298454n,
                    s: 20663247868890391450363957100878086376161396675631391829127242325233880313431n,
                }).toBase58(),
            },
        ],
    });

    logger.info("Seeded initial blocks (height 0 and 1).");
}
