import "dotenv/config";
import mongoose from "mongoose";
import { Signature } from "o1js";
import logger from "../common/logger.js";
import { BlockModel } from "../db/models/Block.js";
import { BlockEpochModel } from "../db/models/BlockEpoch.js";
import { BLOCK_EPOCH_SIZE } from "../config/constants.js";
import { BlockStatus } from "../common/types.js";

import "../db/models/Proof.js";
import "../db/models/ProofEpoch.js";

async function seedBlocks() {
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

async function seedBlockEpochs() {
    const exists = await BlockEpochModel.exists({ height: 0 });
    if (exists) return;

    const genesisBlock = await BlockModel.findOne({ height: 0 });
    const firstBlock = await BlockModel.findOne({ height: 1 });

    if (!genesisBlock || !firstBlock) {
        throw new Error(
            "Seed block epochs: required blocks at heights 0 and 1 not found in Block collection.",
        );
    }

    const blocks = [
        genesisBlock._id,
        firstBlock._id,
        ...Array(BLOCK_EPOCH_SIZE - 2).fill(null),
    ];

    const status: BlockStatus[] = [
        "done",
        "done",
        ...Array(BLOCK_EPOCH_SIZE - 2).fill("waiting" as BlockStatus),
    ];

    await BlockEpochModel.create({
        height: 0,
        blocks,
        status,
    });

    logger.info("Seeded initial block epoch (height 0).");
}

async function main() {
    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar";

    await mongoose.connect(uri, { dbName });
    logger.info(`Connected to MongoDB (db: "${dbName}").`);

    await seedBlocks();
    await seedBlockEpochs();

    await mongoose.disconnect();
    logger.info("Seeding complete.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
