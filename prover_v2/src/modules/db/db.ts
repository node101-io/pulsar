import mongoose from "mongoose";
import logger from "../../logger.js";

import "./models/block/Block.js";
import "./models/proof/Proof.js";
import "./models/proofEpoch/ProofEpoch.js";
import "./models/blockEpoch/BlockEpoch.js";

let initialized = false;

export async function initDb() {
    if (initialized) return;

    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar";

    await mongoose.connect(uri, { dbName });

    initialized = true;

    logger.info(`Connected to MongoDB via Mongoose (db: "${dbName}").`);
}
