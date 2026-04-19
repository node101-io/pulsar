import "dotenv/config";
import mongoose from "mongoose";
import logger from "../common/logger.js";
import { BlockModel } from "../db/models/Block.js";

import "../db/models/Proof.js";
import "../db/models/ProofEpoch.js";
import "../db/models/BlockEpoch.js";

async function seedGenesisBlock() {
    const exists = await BlockModel.exists({ height: 0 });
    if (exists) {
        logger.info("Genesis block already exists, skipping seed.");
        return;
    }

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

    logger.info("Seeded genesis block (height 0).");
}

async function main() {
    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar";

    await mongoose.connect(uri, { dbName });
    logger.info(`Connected to MongoDB (db: "${dbName}").`);

    await seedGenesisBlock();

    await mongoose.disconnect();
    logger.info("Seeding complete.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
