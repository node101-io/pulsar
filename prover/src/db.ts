import { MongoClient, Collection, Document } from "mongodb";
import { ActionStackProof, SettlementProof, ValidateReduceProof } from "pulsar-contracts";
import logger from "./logger";
import { JsonProof } from "o1js";

type ProofKind = "actionStack" | "settlement" | "validateReduce";

interface ProofDoc extends Document {
    kind: ProofKind;
    range_low: bigint;
    range_high: bigint;
    json: string;
    stored_at: Date;
}

let client: MongoClient;
let proofsCol: Collection<ProofDoc>;

export async function initMongo() {
    if (client) return;

    const uri = process.env.MONGO_URI ?? "mongodb://mongo:27017";
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    proofsCol = client.db(db).collection<ProofDoc>("proofs");

    await proofsCol.createIndex({ kind: 1, range_high: 1 }, { unique: true });
    await proofsCol.createIndex({ kind: 1, range_low: 1 });

    logger.info(`MongoDB connected at ${uri}, using database "${db}"`);
}

export async function storeProof(
    range_low: bigint,
    range_high: bigint,
    kind: ProofKind,
    proof: ActionStackProof | SettlementProof | ValidateReduceProof
) {
    await initMongo();

    await proofsCol.updateOne(
        { kind, range_high, range_low },
        {
            $setOnInsert: {
                kind,
                range_low,
                range_high,
                json: JSON.stringify(proof.toJSON()),
                stored_at: new Date(),
            },
        },
        { upsert: true }
    );

    logger.info(`Stored ${kind} proof for range [${range_low}, ${range_high}]`);
}

export async function fetchProofs(
    kind: ProofKind,
    range_low: bigint,
    range_high: bigint
): Promise<(ActionStackProof | SettlementProof | ValidateReduceProof)[]> {
    await initMongo();

    const docs = await proofsCol
        .find({ kind, range_low: { $lte: range_high }, range_high: { $gte: range_low } })
        .sort({ range_high: -1 })
        .toArray();

    logger.info(`Fetched ${docs.length} ${kind} proofs for range [${range_low}, ${range_high}]`);

    const proofs = docs.map((doc) => deserializeProof(doc));
    return Promise.all(proofs);
}

export async function deserializeProof(
    doc: ProofDoc
): Promise<ActionStackProof | SettlementProof | ValidateReduceProof> {
    const json = JSON.parse(doc.json) as JsonProof;
    if (doc.kind === "actionStack") {
        return await ActionStackProof.fromJSON(json);
    } else if (doc.kind === "settlement") {
        return await SettlementProof.fromJSON(json);
    } else {
        return await ValidateReduceProof.fromJSON(json);
    }
}
