import { VoteExt } from "../utils/interfaces.js";
import {
    fetchBlockRange,
    fetchLastStoredBlock,
    incrementRetryCount,
} from "./utils.js";
import { MongoClient, Collection, Document } from "mongodb";

type ProofKind = "blockProof" | "aggregation" | "settlement";

interface ProofDoc extends Document {}

interface BlockDoc extends Document {
    height: number;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
}

interface ProofEpochDoc extends Document {}

let client: MongoClient;
let blocksCol: Collection<BlockDoc>;
let proofsCol: Collection<ProofDoc>;
let proofEpochsCol: Collection<ProofEpochDoc>;

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
    proofEpochsCol = client.db(db).collection<ProofEpochDoc>("proofEpochs");

    await blocksCol.createIndex({ height: 1 }, { unique: true });

    await proofEpochsCol.createIndex({ height: 1 }, { unique: true });

    // TODO: store block, logs
}

export async function storeProof() {}

export async function deleteProof() {}

export async function getProof() {}

export async function deserializeProof() {}

export async function storeBlock() {}

export async function getBlock() {}
