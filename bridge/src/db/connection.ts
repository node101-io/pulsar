import mongoose from "mongoose";
import logger from "../common/logger.js";

import "./models/MinaAction.js";
import "./models/BridgeState.js";

let initialized = false;

export async function initDb() {
    if (initialized) return;

    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar-bridge";

    await mongoose.connect(uri, { dbName });

    initialized = true;

    logger.info(`Connected to MongoDB (db: "${dbName}").`);
}
