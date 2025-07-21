import { MongoClient, Collection, Document } from "mongodb";
import logger from "./logger.js";

interface SignatureDoc extends Document {
    blockHeight: number;
    actionState: string;
    signature: string;
}

interface InvalidAttemptDoc extends Document {
    ip: string;
    lastAttempt: Date;
    count: number;
}

let client: MongoClient;
let signaturesCol: Collection<SignatureDoc>;
let invalidAttemptsCol: Collection<InvalidAttemptDoc>;

export async function initMongo() {
    if (client) return;

    const uri = process.env.MONGO_URI ?? "mongodb://mongo:27017";
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    signaturesCol = client.db(db).collection<SignatureDoc>("signatures");
    invalidAttemptsCol = client.db(db).collection<InvalidAttemptDoc>("invalid_attempts");

    await invalidAttemptsCol.createIndex({ ip: 1 }, { unique: true });
    await signaturesCol.createIndex({ blockHeight: 1, actionState: 1 }, { unique: true });

    logger.info(`MongoDB connected at ${uri}, using database "${db}"`);
}

export async function saveSignature(
    blockHeight: number,
    actionState: string,
    signature: string
): Promise<void> {
    const doc: SignatureDoc = { blockHeight, actionState, signature };

    try {
        await signaturesCol.insertOne(doc);
        logger.info(`Signature saved for block ${blockHeight}, state ${actionState}`);
    } catch (error) {
        logger.error(`Failed to save signature: ${error}`);
        throw error;
    }
}

export async function getSignature(
    blockHeight: number,
    actionState: string
): Promise<string | null> {
    const doc = await signaturesCol.findOne({ blockHeight, actionState });

    if (!doc) {
        logger.warn(`No signature found for block ${blockHeight}, state ${actionState}`);
        return null;
    }

    return doc.signature;
}

const MAX_INVALID_ATTEMPTS = 2;
const WINDOW_MS = 10 * 60 * 1000;

export async function registerInvalidAttempt(ip: string) {
    await invalidAttemptsCol.findOneAndUpdate(
        { ip },
        [
            {
                $set: {
                    count: {
                        $cond: [
                            { $lt: ["$lastAttempt", new Date(Date.now() - WINDOW_MS)] },
                            1,
                            { $add: ["$count", 1] },
                        ],
                    },
                    lastAttempt: new Date(),
                },
            },
        ],
        { upsert: true, returnDocument: "after" }
    );
}

export async function isIpBlocked(ip: string): Promise<boolean> {
    const doc = await invalidAttemptsCol.findOne({ ip });
    if (!doc) return false;
    return doc.count >= MAX_INVALID_ATTEMPTS && doc.lastAttempt > new Date(Date.now() - WINDOW_MS);
}

export async function resetInvalidAttempts(ip: string) {
    await invalidAttemptsCol.deleteOne({ ip });
}
