import "dotenv/config";
import mongoose from "mongoose";
import {
    getLatestHeight,
    grpcCredentials,
    AbciQueryClient,
    KeyregistryClient,
    TendermintClient,
    VotePersistenceClient,
} from "pulsar-chain-client";

import logger from "../common/logger.js";
import { BlockModel } from "../db/models/Block.js";
import { getBlockData, storePulsarBlock } from "../services/pulsar/client.js";
import {
    ANCHOR_BLOCK_HEIGHT,
    VOTE_EXT_PERSISTENCE_LAG,
} from "../config/constants.js";

import "../db/models/Proof.js";
import "../db/models/ProofEpoch.js";
import "../db/models/BlockEpoch.js";

/**
 * Ingests the anchor block — the one the first settlement proof starts from and
 * the SettlementContract is initialized against.
 *
 * It goes through the production ingest path on purpose: the record the deploy
 * script reads must be the very same one the first proof later consumes as its
 * `prev` block. Deriving it separately would let the contract's initial state
 * and the proof's Initial* values drift apart, and the only symptom would be an
 * on-chain precondition failure long after deploy.
 *
 * Sync picks up from here — it resumes from the highest stored block.
 */
async function seedAnchorBlock() {
    if (await BlockModel.exists({ height: ANCHOR_BLOCK_HEIGHT })) {
        logger.info("Anchor block already exists, skipping seed.", {
            height: ANCHOR_BLOCK_HEIGHT,
        });
        return;
    }

    const endpoint = process.env.PULSAR_GRPC_ENDPOINT;
    if (!endpoint) {
        throw new Error(
            "PULSAR_GRPC_ENDPOINT is not set — seeding reads the anchor block " +
                "from the chain, so the chain must be running",
        );
    }

    const creds = grpcCredentials(endpoint);
    const tm = new TendermintClient(endpoint, creds);
    const vp = new VotePersistenceClient(endpoint, creds);
    const kr = new KeyregistryClient(endpoint, creds);
    const abci = new AbciQueryClient(endpoint, creds);

    // The anchor's vote extensions only exist once the chain is this tall.
    // Without the check the ingest fails deep inside gRPC with "cannot query
    // with height in the future", which says nothing about waiting for blocks.
    const requiredHeight = ANCHOR_BLOCK_HEIGHT + VOTE_EXT_PERSISTENCE_LAG;
    const latestHeight = await getLatestHeight(tm);
    if (latestHeight < requiredHeight) {
        throw new Error(
            `Chain is at height ${latestHeight}, but anchor block ` +
                `${ANCHOR_BLOCK_HEIGHT} cannot be ingested until height ` +
                `${requiredHeight} exists (vote extensions lag by ` +
                `${VOTE_EXT_PERSISTENCE_LAG}). Let the chain produce a few more ` +
                "blocks and re-run.",
        );
    }

    const data = await getBlockData(tm, vp, kr, abci, ANCHOR_BLOCK_HEIGHT);
    await storePulsarBlock(data);

    logger.info("Seeded anchor block.", {
        height: ANCHOR_BLOCK_HEIGHT,
        stateRoot: data.stateRoot,
        validatorsCount: data.validators.length,
    });
}

async function main() {
    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar";

    await mongoose.connect(uri, { dbName });
    logger.info(`Connected to MongoDB (db: "${dbName}").`);

    await seedAnchorBlock();

    await mongoose.disconnect();
    logger.info("Seeding complete.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
