import { MongoClient, Collection, ObjectId } from "mongodb";
import { ProofStatus } from "./types.js";
import { ProofDoc, BlockDoc, ProofEpochDoc } from "./interfaces.js";
import { Signature } from "o1js";
import { BlockData } from "../utils/interfaces.js";
import logger from "../../logger.js";

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

        await this.storeBlock({
            height: 0,
            stateRoot: BigInt(
                "0x" +
                    Buffer.from(
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "base64",
                    ).toString("hex"),
            ).toString(),
            validators: [
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            ],
            validatorListHash:
                "6310558633462665370159457076080992493592463962672742685757201873330974620505",
            voteExt: [],
        });

        await this.storeBlock({
            height: 1,
            stateRoot: BigInt(
                "0x" +
                    Buffer.from(
                        "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
                        "base64",
                    ).toString("hex"),
            ).toString(),
            validators: [
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            ],
            validatorListHash:
                "6310558633462665370159457076080992493592463962672742685757201873330974620505",
            voteExt: [
                {
                    index: "0",
                    height: 1,
                    validatorAddr:
                        "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                    signature: Signature.fromValue({
                        r: 1252644915096851551329970336594686639171015300754931693803244151631871298454n,
                        s: 20663247868890391450363957100878086376161396675631391829127242325233880313431n,
                    }).toBase58(),
                },
            ],
        });

        logger.info("Connected to MongoDB and initialized collections.");
    }

    async storeProof(data: string): Promise<ObjectId> {
        await this.ensureConnected();

        const result = await this.proofsCol.insertOne({ data } as ProofDoc);

        logger.info(`Stored proof with id ${result.insertedId.toHexString()}.`);

        return result.insertedId;
    }

    async deleteProof(id: ObjectId) {
        await this.ensureConnected();
        await this.proofsCol.deleteOne({ _id: id });

        logger.info(`Deleted proof with id ${id.toHexString()}.`);
    }

    async getProof(id: ObjectId) {
        await this.ensureConnected();

        const proof = await this.proofsCol.findOne({ _id: id });

        if (!proof || !proof.data) throw new Error("Proof not found");

        logger.info(`Retrieved proof with id ${id.toHexString()}.`);
        return JSON.parse(proof.data);
    }

    async storeProofInProofEpoch(
        height: number,
        proof: ObjectId,
        index: number,
    ) {
        await this.ensureConnected();
        if (index < 0 || index > 31) {
            throw new Error("Index must be between 0 and 31");
        }

        if (index > 15) {
            await this.proofEpochsCol.findOneAndUpdate(
                { height },
                {
                    $set: {
                        [`proofs.${index}`]: proof,
                        [`status.${index % 16}`]: "done" as ProofStatus,
                    },
                },
            );
        } else {
            await this.proofEpochsCol.findOneAndUpdate(
                { height },
                {
                    $set: {
                        [`proofs.${index}`]: proof,
                    },
                },
            );
        }

        logger.info(
            `Stored proof ${proof.toHexString()} in proof epoch at height ${height} for index ${index}.`,
        );
    }

    async deleteProofEpoch(height: number) {
        await this.ensureConnected();

        await this.proofEpochsCol.deleteOne({ height });

        logger.info(`Deleted proof epoch at height ${height}.`);
    }

    async getProofEpoch(height: number) {
        await this.ensureConnected();

        const proofEpoch = await this.proofEpochsCol.findOne({ height });

        logger.info(`Retrieved proof epoch at height ${height}.`);
        return proofEpoch;
    }

    async storeBlock(block: BlockData) {
        await this.ensureConnected();

        await this.blocksCol.updateOne(
            { height: block.height },
            { $set: block as BlockDoc },
            { upsert: true },
        );

        logger.info(`Stored block at height ${block.height}.`);
    }

    async getBlock(height: number) {
        await this.ensureConnected();

        logger.info(`Retrieved block at height ${height}.`);

        return this.blocksCol.findOne({ height });
    }

    async ensureConnected() {
        if (!this.client) {
            await this.initMongo();
        }
    }
}
