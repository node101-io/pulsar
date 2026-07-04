import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "pulsar";

async function dropDatabase() {
    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
    await mongoose.connection.db!.dropDatabase();
    console.log(`Dropped database: ${MONGO_DB}`);
    await mongoose.disconnect();
}

async function main() {
    await dropDatabase();
    console.log("Reset complete.");
}

main().catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
});
