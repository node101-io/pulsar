import { MongoClient, Collection, Document } from "mongodb";
import logger from "./logger.js";

interface SignatureDoc extends Document {
    blockHeight: number;
    actionState: string;
    signature: string;
}

let client: MongoClient;
let signaturesCol: Collection<SignatureDoc>;

export async function initMongo() {
    if (client) return;

    const uri = process.env.MONGO_URI ?? "mongodb://mongo:27017";
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    signaturesCol = client.db(db).collection<SignatureDoc>("signatures");

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
