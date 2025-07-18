import { MongoClient, Collection, Document } from "mongodb";
import { ActionStackProof, SettlementProof, ValidateReduceProof } from "pulsar-contracts";
import { JsonProof } from "o1js";
import logger from "./logger.js";
import { VoteExt } from "./pulsarClient.js";

type ProofKind = "actionStack" | "settlement" | "validateReduce";

interface ProofDoc extends Document {
    kind: ProofKind;
    range_low: number;
    range_high: number;
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

    const uri = `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    proofsCol = client.db(db).collection<ProofDoc>("proofs");
    blocksCol = client.db(db).collection<BlockDoc>("blocks");

    await proofsCol.createIndex({ kind: 1, range_high: 1, range_low: 1 }, { unique: true });

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
    range_low: number,
    range_high: number,
    kind: ProofKind,
    proof: ActionStackProof | SettlementProof | ValidateReduceProof
) {
    await initMongo();

    try {
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
    } catch (error) {
        logger.error(`Failed to store proof for range [${range_low}, ${range_high}]: ${error}`);
        throw error;
    }
}

export async function deleteProof(kind: ProofKind, range_low: number, range_high: number) {
    await initMongo();
    await proofsCol.deleteOne({ kind, range_low, range_high });
    logger.info(`Deleted ${kind} proof for range [${range_low}, ${range_high}]`);
}

export async function fetchMultipleProofs(
    kind: ProofKind,
    range_low: number,
    range_high: number
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

export async function fetchProof(
    kind: ProofKind,
    range_low: number,
    range_high: number
): Promise<ActionStackProof | SettlementProof | ValidateReduceProof> {
    await initMongo();

    const doc = await proofsCol.findOne({ kind, range_low, range_high });
    if (!doc) {
        throw new Error(`Proof not found for kind ${kind} and range [${range_low}, ${range_high}]`);
    }
    logger.info(`Fetched ${kind} proof for range [${range_low}, ${range_high}]`);
    return deserializeProof(doc);
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

export async function fetchLastStoredBlock(): Promise<BlockDoc | null> {
    await initMongo();

    const block = await blocksCol.findOne({}, { sort: { height: -1 } });
    if (!block) {
        logger.warn("No blocks found in the database");
        return null;
    }

    logger.info(`Fetched last stored block at height ${block.height}`);
    return block;
}
