/**
 * Deploys and initializes the SettlementContract to the configured Mina network.
 *
 * The initial merkleListRoot (block 0's validatorListHash) is resolved automatically:
 *   1. INITIAL_MERKLE_LIST_ROOT env var  (explicit override)
 *   2. MongoDB Block collection, height=0 (preferred — most accurate)
 *   3. mock-state.json blocks["0"].validatorListHash (fallback)
 *
 * Required env vars:
 *   MINA_PRIVATE_KEY   - Base58 private key of the fee-paying signer account
 *   MINA_NETWORK       - "devnet" | "mainnet" | "lightnet"
 *   MONGO_URI          - MongoDB connection string (used for auto-detection)
 *   MONGO_DB           - MongoDB database name   (used for auto-detection)
 *
 * Optional:
 *   INITIAL_MERKLE_LIST_ROOT - override automatic detection
 *   MINA_FEE                 - TX fee in nanomina (default: 100_000_000 = 0.1 MINA)
 *   CONTRACT_PRIVATE_KEY     - reuse an existing contract key instead of a fresh one
 *   MOCK_STATE_PATH          - path to mock-state.json (default: ./mock-state.json)
 *
 * On success prints:
 *   CONTRACT_ADDRESS=...
 *   CONTRACT_PRIVATE_KEY=...
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { AccountUpdate, fetchAccount, Field, Mina, PrivateKey } from "o1js";
import mongoose from "mongoose";
import {
    setMinaNetwork,
    SettlementContract,
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    ActionStackProof,
} from "pulsar-contracts";

type MinaNetwork = "devnet" | "mainnet" | "lightnet";

// ── hash resolution ──────────────────────────────────────────────────────────

async function resolveInitialMerkleListRoot(): Promise<string> {
    // 1. Explicit env override
    if (process.env.INITIAL_MERKLE_LIST_ROOT) {
        console.log("Using INITIAL_MERKLE_LIST_ROOT from env.");
        return process.env.INITIAL_MERKLE_LIST_ROOT;
    }

    // 2. MongoDB Block collection
    const mongoHash = await readFromMongo();
    if (mongoHash) {
        console.log(`Auto-detected merkleListRoot from MongoDB block 0: ${mongoHash}`);
        return mongoHash;
    }

    // 3. mock-state.json
    const stateHash = await readFromMockState();
    if (stateHash) {
        console.log(`Auto-detected merkleListRoot from mock-state.json block 0: ${stateHash}`);
        return stateHash;
    }

    throw new Error(
        "Cannot determine INITIAL_MERKLE_LIST_ROOT.\n" +
        "Make sure the mock chain has produced at least one block and either:\n" +
        "  - MongoDB is reachable (MONGO_URI / MONGO_DB set), or\n" +
        "  - mock-state.json exists in the current directory, or\n" +
        "  - Set INITIAL_MERKLE_LIST_ROOT explicitly in .env",
    );
}

interface Block0 {
    validatorListHash: string;
    stateRoot: string;
}

async function readBlock0FromMongo(): Promise<Block0 | null> {
    const uri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB ?? "pulsar";
    if (!uri) return null;

    try {
        await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 3000 });
        const db = mongoose.connection.db!;
        const block = await db.collection("blocks").findOne({ height: 0 });
        await mongoose.disconnect();
        if (block?.validatorListHash && block?.stateRoot) {
            return {
                validatorListHash: String(block.validatorListHash),
                stateRoot: String(block.stateRoot),
            };
        }
    } catch {
        try { await mongoose.disconnect(); } catch { /* ignore */ }
    }
    return null;
}

async function readFromMongo(): Promise<string | null> {
    const b = await readBlock0FromMongo();
    return b?.validatorListHash ?? null;
}

async function readFromMockState(): Promise<string | null> {
    const path = process.env.MOCK_STATE_PATH ?? "./mock-state.json";
    try {
        const raw = await readFile(path, "utf8");
        const state = JSON.parse(raw);
        const hash = state?.blocks?.["0"]?.validatorListHash;
        return hash ? String(hash) : null;
    } catch {
        return null;
    }
}

async function resolveInitialStateRoot(): Promise<string> {
    if (process.env.INITIAL_STATE_ROOT) {
        console.log("Using INITIAL_STATE_ROOT from env.");
        return process.env.INITIAL_STATE_ROOT;
    }

    // Try MongoDB first
    const b = await readBlock0FromMongo();
    if (b?.stateRoot) {
        console.log(`Auto-detected stateRoot from MongoDB block 0: ${b.stateRoot}`);
        return b.stateRoot;
    }

    // Fallback: mock-state.json
    const path = process.env.MOCK_STATE_PATH ?? "./mock-state.json";
    try {
        const raw = await readFile(path, "utf8");
        const state = JSON.parse(raw);
        const sr = state?.blocks?.["0"]?.stateRoot;
        if (sr) {
            console.log(`Auto-detected stateRoot from mock-state.json block 0: ${sr}`);
            return String(sr);
        }
    } catch { /* ignore */ }

    console.log("stateRoot not found, defaulting to 0.");
    return "0";
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    const signerKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!signerKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const network = (process.env.MINA_NETWORK ?? "devnet") as MinaNetwork;
    const fee = Number(process.env.MINA_FEE ?? "100000000");

    const merkleListRootStr = await resolveInitialMerkleListRoot();
    const stateRootStr = await resolveInitialStateRoot();

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
    await MultisigVerifierProgram.compile();
    console.log("MultisigVerifierProgram done.");
    await ValidateReduceProgram.compile();
    console.log("ValidateReduceProgram done.");
    await ActionStackProgram.compile();
    console.log("ActionStackProgram done.");
    await SettlementContract.compile();
    console.log("SettlementContract done.");

    // ── fetch signer ────────────────────────────────────────────────────────
    console.log(`Fetching signer account: ${signerPublicKey.toBase58()}`);
    await fetchAccount({ publicKey: signerPublicKey });

    // ── build & prove tx ────────────────────────────────────────────────────
    const contractInstance = new SettlementContract(contractPublicKey);
    const merkleListRoot = Field.from(merkleListRootStr);
    const stateRoot = Field.from(stateRootStr);

    console.log(`Deploying with merkleListRoot: ${merkleListRootStr}`);
    console.log(`Deploying with stateRoot:      ${stateRootStr}`);
    const dummyProof = await ActionStackProof.dummy(Field(0), Field(0), 0);

    console.log("Building deploy + initialize transaction…");
    const tx = await Mina.transaction({ sender: signerPublicKey, fee }, async () => {
        AccountUpdate.fundNewAccount(signerPublicKey);
        await contractInstance.deploy();
        await contractInstance.initialize(merkleListRoot, stateRoot, dummyProof);
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
