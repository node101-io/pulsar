import "dotenv/config";
import { rm } from "fs/promises";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "pulsar";

const STATE_FILES = [
    "./mock-state.json",
    "./mock-state.json.tmp",
    "./mock-sync-state.json",
    "./mock-sync-state.json.tmp",
];

async function deleteStateFiles() {
    for (const f of STATE_FILES) {
        try {
            await rm(f);
            console.log(`Deleted ${f}`);
        } catch {
            // file doesn't exist, ignore
        }
    }
}

async function dropDatabase() {
    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
    await mongoose.connection.db!.dropDatabase();
    console.log(`Dropped database: ${MONGO_DB}`);
    await mongoose.disconnect();
}

async function main() {
    await deleteStateFiles();
    await dropDatabase();
    console.log("Reset complete.");
}

main().catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
});
