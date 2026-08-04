import mongoose from "mongoose";
import logger from "../common/logger.js";
import { env } from "../config/env.js";

import "./models/BridgeState.js";

let initialized = false;

export async function initDb() {
    if (initialized) return;

    await mongoose.connect(env.MONGO_URI, { dbName: env.MONGO_DB });

    initialized = true;

    logger.info(`Connected to MongoDB (db: "${env.MONGO_DB}").`);
}
