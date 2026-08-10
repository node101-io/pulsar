import "dotenv/config";
import { Cache, setBackend } from "o1js";
// wasm compiles everywhere in ~10s; the native backend crashes on some hosts.
setBackend("wasm");

import mongoose from "mongoose";
import { MultisigVerifierProgram } from "pulsar-contracts";

import { initDb } from "../db/index.js";
import {
    getLatestHeight,
    grpcCredentials,
    AbciQueryClient,
    KeyregistryClient,
    TendermintClient,
    VotePersistenceClient,
} from "pulsar-chain-client";
import {
    getBlockData,
    storePulsarBlock,
} from "../services/pulsar/client.js";
import { createProof } from "../workers/block-prover/worker.js";
import { BLOCK_EPOCH_SIZE, CACHE_DIR } from "../config/constants.js";
import logger from "../common/logger.js";

/**
 * One-shot end-to-end smoke test against a running Pulsar node: ingests the
 * blocks [E-1 .. E+BLOCK_EPOCH_SIZE-1] through the production ingest path
 * (getBlockData + storePulsarBlock), then generates a SettlementProof for the
 * epoch through the production proving path (block-prover createProof).
 *
 * Pick the window with PROVE_EPOCH_HEIGHT=<E>; defaults to a recent window
 * near the chain tip. Exits 0 on success, 1 on any failure.
 */
async function main() {
    await initDb();

    const rpc = process.env.PULSAR_GRPC_ENDPOINT || "localhost:9090";
    const creds = grpcCredentials(rpc);
    const tm = new TendermintClient(rpc, creds);
    const vp = new VotePersistenceClient(rpc, creds);
    const kr = new KeyregistryClient(rpc, creds);
    const abci = new AbciQueryClient(rpc, creds);

    const latest = await getLatestHeight(tm);
    const usableTop = latest - 3; // vote extensions for H are persisted at H+3

    let E = Number(process.env.PROVE_EPOCH_HEIGHT ?? 0);
    if (E <= 0) {
        E = usableTop - BLOCK_EPOCH_SIZE; // most recent full [E-1 .. E+7] window
    }
    if (E - 1 < 2) throw new Error(`epoch height too low: ${E}`);
    if (E + BLOCK_EPOCH_SIZE - 1 > usableTop) {
        throw new Error(
            `window [${E - 1}..${E + BLOCK_EPOCH_SIZE - 1}] exceeds usable top ${usableTop} (latest ${latest})`,
        );
    }

    logger.info(
        `Ingesting blocks [${E - 1}..${E + BLOCK_EPOCH_SIZE - 1}] (latest=${latest})`,
    );
    for (let h = E - 1; h <= E + BLOCK_EPOCH_SIZE - 1; h++) {
        const data = await getBlockData(tm, vp, kr, abci, h);
        if (!data.validatorListHash) {
            throw new Error(
                `block ${h} has no vote-ext body (validatorListHash missing)`,
            );
        }
        await storePulsarBlock(data);
    }

    logger.info("Compiling MultisigVerifierProgram...");
    await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });

    logger.info(`Generating settlement proof for epoch ${E}...`);
    const proofId = await createProof(E);

    logger.info("✅ SMOKE TEST PASSED — SettlementProof generated", {
        epochHeight: E,
        proofId: proofId.toHexString(),
    });

    await mongoose.disconnect();
}

main().catch(async (err) => {
    logger.error("❌ SMOKE TEST FAILED", {
        error: err instanceof Error ? err.message : String(err),
    });
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
