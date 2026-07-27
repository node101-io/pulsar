import "dotenv/config";
import mongoose from "mongoose";
import * as grpc from "@grpc/grpc-js";
import {
    getValidatorSet,
    sortValidatorsByPower,
    KeyregistryClient,
    TendermintClient,
} from "pulsar-chain-client";

import logger from "../common/logger.js";
import { BlockModel } from "../db/models/Block.js";
import { computeValidatorListHash } from "../services/pulsar/client.js";

import "../db/models/Proof.js";
import "../db/models/ProofEpoch.js";
import "../db/models/BlockEpoch.js";

// The genesis validator set is whatever signs block 1 — read it from the
// chain instead of hardcoding, so the seeded hash always matches the network
// the prover is pointed at.
async function fetchGenesisValidators() {
    const endpoint = process.env.PULSAR_GRPC_ENDPOINT;
    if (!endpoint) {
        throw new Error(
            "PULSAR_GRPC_ENDPOINT is not set — seeding reads the genesis " +
                "validator set from the chain, so the chain must be running",
        );
    }

    const creds = grpc.credentials.createInsecure();
    const tm = new TendermintClient(endpoint, creds);
    const kr = new KeyregistryClient(endpoint, creds);

    const validators = sortValidatorsByPower(
        await getValidatorSet(tm, kr, 1, logger),
    ).map(({ minaPublicKey, power }) => ({ addr: minaPublicKey, power }));

    if (validators.length === 0) {
        throw new Error("chain returned an empty validator set at height 1");
    }
    return validators;
}

async function seedGenesisBlock() {
    const exists = await BlockModel.exists({ height: 0 });
    if (exists) {
        logger.info("Genesis block already exists, skipping seed.");
        return;
    }

    const validators = await fetchGenesisValidators();

    await BlockModel.create({
        height: 0,
        status: "done",
        stateRoot: BigInt(
            "0x" +
                Buffer.from(
                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                    "base64",
                ).toString("hex"),
        ).toString(),
        validators,
        // Derived with the same leaf convention the circuits verify.
        validatorListHash: computeValidatorListHash(validators),
        voteExt: [],
    });

    logger.info("Seeded genesis block (height 0).", {
        validatorsCount: validators.length,
    });
}

async function main() {
    const uri =
        process.env.MONGO_URI ??
        `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@mongo:27017/${process.env.MONGO_DB}?authSource=admin`;

    const dbName = process.env.MONGO_DB ?? "pulsar";

    await mongoose.connect(uri, { dbName });
    logger.info(`Connected to MongoDB (db: "${dbName}").`);

    await seedGenesisBlock();

    await mongoose.disconnect();
    logger.info("Seeding complete.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
