import { MongoClient, Collection, Document } from "mongodb";
import { ActionStackProof, SettlementProof, ValidateReduceProof } from "pulsar-contracts";
import { JsonProof } from "o1js";
import logger from "./logger.js";
import { VoteExt } from "./pulsarClient.js";

type ProofKind = "actionStack" | "settlement" | "validateReduce";

interface ProofDoc extends Document {
    kind: ProofKind;
    range_low: bigint;
    range_high: bigint;
    json: string;
    stored_at: Date;
}

interface BlockDoc extends Document {
    height: number;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExts: VoteExt[];
}

let client: MongoClient;
let blocksCol: Collection<BlockDoc>;
let proofsCol: Collection<ProofDoc>;

export async function initMongo() {
    if (client) return;

    const uri = process.env.MONGO_URI ?? "mongodb://mongo:27017";
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    proofsCol = client.db(db).collection<ProofDoc>("proofs");
    blocksCol = client.db(db).collection<BlockDoc>("blocks");

    await proofsCol.createIndex({ kind: 1, range_high: 1 }, { unique: true });
    await proofsCol.createIndex({ kind: 1, range_low: 1 });

    await blocksCol.createIndex({ height: 1 }, { unique: true });

    await storeBlock(
        0,
        "0",
        [],
        "13658430471246486301243056036277051613844963336367846930281926757677598606706",
        []
    );

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

export async function storeBlock(
    height: number,
    stateRoot: string,
    validators: string[],
    validatorListHash: string,
    voteExts: VoteExt[]
) {
    await initMongo();

    const blockDoc: BlockDoc = {
        height,
        stateRoot,
        validators,
        validatorListHash,
        voteExts,
    };

    await blocksCol.updateOne({ height }, { $set: blockDoc }, { upsert: true });

    logger.info(`Stored block at height ${height}`);
}

export async function fetchBlockRange(range_low: number, range_high: number): Promise<BlockDoc[]> {
    await initMongo();

    const blocks = await blocksCol
        .find({ height: { $gte: range_low, $lte: range_high } })
        .sort({ height: 1 }) // Sort by height ascending
        .toArray();

    logger.info(`Fetched ${blocks.length} blocks in range [${range_low}, ${range_high}]`);
    return blocks;
}
