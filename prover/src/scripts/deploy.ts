/**
 * Deploys and initializes the SettlementContract to the configured Mina network.
 *
 * The contract is anchored to the ANCHOR_BLOCK_HEIGHT record in MongoDB — the
 * block the first settlement proof starts from. `settle` requires the contract's
 * merkleListRoot, stateRoot and blockHeight to equal that proof's Initial*
 * values, so all three are read from that one block. Run `pnpm run seed` first;
 * it writes the anchor block.
 *
 * Required env vars:
 *   MINA_PRIVATE_KEY   - Base58 private key of the fee-paying signer account
 *   MINA_NETWORK       - "devnet" | "mainnet" | "lightnet"
 *   MONGO_URI          - MongoDB connection string
 *   MONGO_DB           - MongoDB database name
 *
 * Optional:
 *   MINA_FEE             - TX fee in nanomina (default: 100_000_000 = 0.1 MINA)
 *   CONTRACT_PRIVATE_KEY - reuse an existing contract key instead of a fresh one
 *
 * On success prints:
 *   CONTRACT_ADDRESS=...
 *   CONTRACT_PRIVATE_KEY=...
 */

import "dotenv/config";
import { AccountUpdate, Cache, fetchAccount, Field, Mina, PrivateKey } from "o1js";
import mongoose from "mongoose";
import {
    setMinaNetwork,
    SettlementContract,
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
} from "pulsar-contracts";

import { type AnchorBlock, fetchAnchorBlock } from "../db/index.js";
import { CACHE_DIR } from "../config/constants.js";

type MinaNetwork = "devnet" | "mainnet" | "lightnet";

// ── anchor resolution ────────────────────────────────────────────────────────

/** Connects, delegates to the shared resolver, disconnects. */
async function readAnchorBlock(): Promise<AnchorBlock> {
    const uri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB ?? "pulsar";
    if (!uri) throw new Error("MONGO_URI is not set");

    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 3000 });
    try {
        return await fetchAnchorBlock();
    } finally {
        await mongoose.disconnect();
    }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    const signerKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!signerKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const network = (process.env.MINA_NETWORK ?? "devnet") as MinaNetwork;
    const fee = Number(process.env.MINA_FEE ?? "100000000");

    const anchor = await readAnchorBlock();

    // ── key setup ───────────────────────────────────────────────────────────
    const signerPrivateKey = PrivateKey.fromBase58(signerKeyBase58);
    const signerPublicKey = signerPrivateKey.toPublicKey();

    const contractPrivateKey = process.env.CONTRACT_PRIVATE_KEY
        ? PrivateKey.fromBase58(process.env.CONTRACT_PRIVATE_KEY)
        : PrivateKey.random();
    const contractPublicKey = contractPrivateKey.toPublicKey();

    // ── network ─────────────────────────────────────────────────────────────
    setMinaNetwork(network);

    // ── compile ─────────────────────────────────────────────────────────────
    console.log("Compiling ZK programs (this can take several minutes)…");
    await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("MultisigVerifierProgram done.");
    await ValidateReduceProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("ValidateReduceProgram done.");
    await ActionStackProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("ActionStackProgram done.");
    await SettlementContract.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("SettlementContract done.");

    // ── fetch signer ────────────────────────────────────────────────────────
    console.log(`Fetching signer account: ${signerPublicKey.toBase58()}`);
    await fetchAccount({ publicKey: signerPublicKey });

    // ── build & prove tx ────────────────────────────────────────────────────
    const contractInstance = new SettlementContract(contractPublicKey);
    const merkleListRoot = Field.from(anchor.validatorListHash);
    const stateRoot = Field.from(anchor.stateRoot);
    const blockHeight = Field.from(anchor.height);

    console.log(`Anchoring to Pulsar block ${anchor.height}`);
    console.log(`  merkleListRoot: ${anchor.validatorListHash}`);
    console.log(`  stateRoot:      ${anchor.stateRoot}`);

    console.log("Building deploy + initialize transaction…");
    const tx = await Mina.transaction({ sender: signerPublicKey, fee }, async () => {
        AccountUpdate.fundNewAccount(signerPublicKey);
        await contractInstance.deploy();
        await contractInstance.initialize(merkleListRoot, stateRoot, blockHeight);
    });

    console.log("Proving transaction…");
    await tx.prove();

    console.log("Sending transaction…");
    const pendingTx = await tx.sign([signerPrivateKey, contractPrivateKey]).send();
    console.log(`TX hash: ${pendingTx.hash}`);

    console.log("Waiting for transaction to be included in a block…");
    const result = await pendingTx.safeWait();
    if (result.status === "rejected") {
        throw new Error(
            "Transaction was rejected: " + JSON.stringify(result.errors, null, 2),
        );
    }

    // ── output ──────────────────────────────────────────────────────────────
    console.log("\n=== CONTRACT DEPLOYED & INITIALIZED ===");
    console.log(`CONTRACT_ADDRESS=${contractPublicKey.toBase58()}`);
    console.log(`CONTRACT_PRIVATE_KEY=${contractPrivateKey.toBase58()}`);
    console.log("\nAdd both lines to your .env file.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
