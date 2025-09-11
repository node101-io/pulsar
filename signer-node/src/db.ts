import { MongoClient, Collection, Document } from "mongodb";

interface CachedSignatureDoc extends Document {
    initialActionState: string;
    finalActionState: string;
    signature: string;
    publicInput: string;
    mask: boolean[];
    timestamp: Date;
}

interface InvalidAttemptDoc extends Document {
    ip: string;
    lastAttempt: Date;
    count: number;
}

let client: MongoClient;
let cachedSignaturesCol: Collection<CachedSignatureDoc>;
let invalidAttemptsCol: Collection<InvalidAttemptDoc>;

export async function initMongo() {
    if (client) return;

    const uri = process.env.MONGO_URI ?? "mongodb://mongo:27017";
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    cachedSignaturesCol = client.db(db).collection<CachedSignatureDoc>("cached_signatures");
    invalidAttemptsCol = client.db(db).collection<InvalidAttemptDoc>("invalid_attempts");

    await invalidAttemptsCol.createIndex({ ip: 1 }, { unique: true });
    await cachedSignaturesCol.createIndex(
        { initialActionState: 1, finalActionState: 1 },
        { unique: true }
    );
    await cachedSignaturesCol.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );
}

export async function saveSignature(
    initialActionState: string,
    finalActionState: string,
    cachedSignature: Omit<CachedSignatureDoc, "_id" | "initialActionState" | "finalActionState">
): Promise<void> {
    try {
        const doc = {
            initialActionState,
            finalActionState,
            ...cachedSignature,
        };
        await cachedSignaturesCol.replaceOne(
            {
                initialActionState,
                finalActionState,
            },
            doc,
            { upsert: true }
        );
        console.info(
            `Cached signature saved for states ${initialActionState} -> ${finalActionState}`
        );
    } catch (error) {
        console.error(`Failed to save signature: ${error}`);
        throw error;
    }
}

export async function getSignature(
    initialActionState: string,
    finalActionState: string
): Promise<CachedSignatureDoc | null> {
    const doc = await cachedSignaturesCol.findOne({
        initialActionState,
        finalActionState,
    });
    if (!doc) {
        console.info(
            `No cached signature found for states ${initialActionState} -> ${finalActionState}`
        );
        return null;
    }
    return doc;
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
