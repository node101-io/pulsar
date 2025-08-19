import { MongoClient, Collection, Document } from "mongodb";
import { ActionStackProof, SettlementProof, ValidateReduceProof } from "pulsar-contracts";
import { JsonProof, Signature } from "o1js";
import logger from "./logger.js";
import { VoteExt } from "./interfaces.js";

type ProofKind = "actionStack" | "settlement" | "validateReduce";

interface ActionBatchDoc extends Document {
    blockHeight: number;
    actionHashes: string[];
    status: "collecting" | "reducing" | "reduced" | "settled";
    createdAt: Date;
    updatedAt: Date;
    reduceJobId?: string;
    settlementTxHash?: string;
    error?: string;
    retryCount: number;
}

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
    voteExt: VoteExt[];
}

let client: MongoClient;
let blocksCol: Collection<BlockDoc>;
let proofsCol: Collection<ProofDoc>;
let actionBatchCol: Collection<ActionBatchDoc>;

export async function initMongo() {
    if (client) return;

    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;
    const db = process.env.MONGO_DB ?? "pulsar";

    client = new MongoClient(uri);
    await client.connect();

    proofsCol = client.db(db).collection<ProofDoc>("proofs");
    blocksCol = client.db(db).collection<BlockDoc>("blocks");
    actionBatchCol = client.db(db).collection<ActionBatchDoc>("actionBatches");

    await proofsCol.createIndex({ kind: 1, range_high: 1, range_low: 1 }, { unique: true });

    await blocksCol.createIndex({ height: 1 }, { unique: true });

    await actionBatchCol.createIndex({ blockHeight: 1 }, { unique: true });
    await actionBatchCol.createIndex({ status: 1, updatedAt: 1 });
    await actionBatchCol.createIndex({ actionHashes: 1 });

    await storeBlock(
        0,
        BigInt(
            "0x" +
                Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "base64").toString(
                    "hex"
                )
        ).toString(),
        ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
        "6310558633462665370159457076080992493592463962672742685757201873330974620505",
        []
    );

    await storeBlock(
        1,
        BigInt(
            "0x" +
                Buffer.from("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", "base64").toString(
                    "hex"
                )
        ).toString(),
        ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
        "6310558633462665370159457076080992493592463962672742685757201873330974620505",
        [
            {
                index: "0",
                height: 1,
                validatorAddr: "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                signature: Signature.fromValue({
                    r: 1252644915096851551329970336594686639171015300754931693803244151631871298454n,
                    s: 20663247868890391450363957100878086376161396675631391829127242325233880313431n,
                }).toBase58(),
            },
        ]
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
    voteExt: VoteExt[]
) {
    await initMongo();

    const blockDoc: BlockDoc = {
        height,
        stateRoot,
        validators,
        validatorListHash,
        voteExt,
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

    if (range_low < 0) {
        blocks.unshift(blocks[0]);
    }

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

export async function getOrCreateActionBatch(
    blockHeight: number,
    actions: { actions: string[][]; hash: string }[]
): Promise<{ isNew: boolean; batch: ActionBatchDoc | null }> {
    await initMongo();

    try {
        const now = new Date();
        const r = await actionBatchCol.updateOne(
            { blockHeight },
            {
                $setOnInsert: {
                    blockHeight,
                    actionHashes: actions.map((a) => a.hash),
                    status: "collecting",
                    createdAt: now,
                    retryCount: 0,
                },
                $set: { updatedAt: now },
            },
            { upsert: true }
        );

        const isNew = r.upsertedCount === 1;
        const batch = await actionBatchCol.findOne({ blockHeight });
        return { isNew, batch: batch as ActionBatchDoc | null };
    } catch (error) {
        logger.error(`Failed to get/create action batch for block ${blockHeight}: ${error}`);
        throw error;
    }
}

export async function updateActionBatchStatus(
    blockHeight: number,
    status: ActionBatchDoc["status"],
    additionalFields?: Partial<ActionBatchDoc>
) {
    await initMongo();

    await actionBatchCol.updateOne(
        { blockHeight },
        {
            $set: {
                status,
                updatedAt: new Date(),
                ...additionalFields,
            },
        }
    );

    logger.info(`Updated action batch status for block ${blockHeight} to ${status}`);
}

export async function getStuckActionBatches(
    stuckThresholdMinutes: number = 10
): Promise<ActionBatchDoc[]> {
    await initMongo();

    const threshold = new Date(Date.now() - stuckThresholdMinutes * 60 * 1000);

    return await actionBatchCol
        .find({
            status: { $in: ["collecting", "reducing"] },
            updatedAt: { $lt: threshold },
            retryCount: { $lt: 3 },
        })
        .toArray();
}

export async function incrementRetryCount(blockHeight: number) {
    await initMongo();

    await actionBatchCol.updateOne(
        { blockHeight },
        {
            $inc: { retryCount: 1 },
            $set: { updatedAt: new Date() },
        }
    );
}

export async function getActionBatch(blockHeight: number): Promise<ActionBatchDoc | null> {
    await initMongo();
    return await actionBatchCol.findOne({ blockHeight });
}
