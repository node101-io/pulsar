import {
    fetchBlockRange,
    fetchLastStoredBlock,
    incrementRetryCount,
} from "./utils.js";
import { MongoClient, Collection, Document } from "mongodb";
import { ProofKind, ProofStatus } from "./types.js";
import { ProofDoc, BlockDoc, ProofEpochDoc } from "./interfaces.js";

export class DB {
    public client: MongoClient;
    public blocksCol: Collection<BlockDoc>;
    public proofsCol: Collection<ProofDoc>;
    public proofEpochsCol: Collection<ProofEpochDoc>;

    async initMongo() {
        if (this.client) return;

        const uri =
            process.env.MONGO_URI ??
            `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;
        const db = process.env.MONGO_DB ?? "pulsar";

        this.client = new MongoClient(uri);
        await this.client.connect();

        this.proofsCol = this.client.db(db).collection<ProofDoc>("proofs");
        this.blocksCol = this.client.db(db).collection<BlockDoc>("blocks");
        this.proofEpochsCol = this.client
            .db(db)
            .collection<ProofEpochDoc>("proofEpochs");

        await this.blocksCol.createIndex({ height: 1 }, { unique: true });

        await this.proofEpochsCol.createIndex({ height: 1 }, { unique: true });

        // TODO: store block, logs
    }

    async storeProof() {}

    async deleteProof() {}

    async getProof() {}

    async deserializeProof() {}

    async storeProofEpoch() {}

    async deleteProofEpoch() {}

    async getProofEpoch() {}

    async storeBlock() {}

    async getBlock() {}
}
