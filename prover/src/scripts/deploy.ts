/**
 * Deploys the SettlementContract to the configured Mina network. Anchors are
 * set in deploy() itself — the permissionless initialize method is gone.
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
import { AccountUpdate, Cache, Field, Mina, PrivateKey } from "o1js";
import mongoose from "mongoose";
import {
    fetchCheckedAccount,
    setMinaNetwork,
    SettlementContract,
    MultisigVerifierProgram,
    SettleAttestProgram,
    ApprovalTailProgram,
    ApprovalQuorumProgram,
    ActionStackProgram,
} from "pulsar-contracts";

import {
    BridgeQueryClient,
    fetchBridgeParams,
    grpcCredentials,
} from "pulsar-chain-client";

import { type AnchorBlock, fetchAnchorBlock } from "../db/index.js";
import { CACHE_DIR } from "../config/constants.js";

type MinaNetwork = "devnet" | "mainnet" | "lightnet";

/**
 * Refuse to deploy anywhere but the address the Pulsar chain adjudicates.
 *
 * The chain bakes contract_address into genesis and its archive wrapper reads
 * it once at startup, so a contract at any other address is one nothing
 * indexes — and the keypair is single-use (deploy makes the verification key
 * immutable and state proof-only), so the remedy is a new keypair AND a new
 * chain genesis. Both roads here are silent: an unset CONTRACT_PRIVATE_KEY
 * mints a random one, and a stale one deploys a perfectly valid contract at
 * yesterday's address.
 *
 * The comparison is against the CHAIN, never against CONTRACT_ADDRESS — a
 * stale .env holds a private key and an address that agree with each other
 * and with nothing else, which is exactly the case a local check waves
 * through. If the chain cannot be reached the deploy stops too: proceeding
 * would mean spending the one keypair on an unverified address.
 */
async function assertAddressMatchesChain(deployAddress: string) {
    const endpoint = process.env.PULSAR_GRPC_ENDPOINT;
    if (!endpoint)
        throw new Error(
            "PULSAR_GRPC_ENDPOINT is not set — cannot confirm the deploy " +
                "address against the chain's x/bridge params, and deploying " +
                "to the wrong address is unrecoverable.",
        );

    const client = new BridgeQueryClient(endpoint, grpcCredentials(endpoint));
    const configured = (await fetchBridgeParams(client)).params?.contract_address;
    if (!configured)
        throw new Error(
            `x/bridge Query/Params on ${endpoint} served no contract_address.`,
        );
    if (configured !== deployAddress)
        throw new Error(
            `Refusing to deploy: this key deploys to ${deployAddress}, but ` +
                `the chain adjudicates ${configured}. Set ` +
                `CONTRACT_PRIVATE_KEY to the key for the chain's address ` +
                `(and remember an unset one generates a random key).`,
        );
    console.log(`Deploy address matches the chain's params: ${configured}`);
}

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

    await assertAddressMatchesChain(contractPublicKey.toBase58());

    // ── network ─────────────────────────────────────────────────────────────
    setMinaNetwork(network);

    // ── compile ─────────────────────────────────────────────────────────────
    console.log("Compiling ZK programs (this can take several minutes)…");
    await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("MultisigVerifierProgram done.");
    await SettleAttestProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("SettleAttestProgram done.");
    await ApprovalTailProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("ApprovalTailProgram done.");
    await ApprovalQuorumProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("ApprovalQuorumProgram done.");
    await ActionStackProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("ActionStackProgram done.");
    await SettlementContract.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    console.log("SettlementContract done.");

    // ── fetch signer ────────────────────────────────────────────────────────
    console.log(`Fetching signer account: ${signerPublicKey.toBase58()}`);
    // Checked on purpose: deploying through a dead node used to fail much
    // later, inside tx building, with an error that read like a key problem.
    await fetchCheckedAccount(signerPublicKey, "Signer fetch");

    // ── build & prove tx ────────────────────────────────────────────────────
    const contractInstance = new SettlementContract(contractPublicKey);
    const merkleListRoot = Field.from(anchor.validatorListHash);
    const stateRoot = Field.from(anchor.stateRoot);
    const blockHeight = Field.from(anchor.height);

    console.log(`Anchoring to Pulsar block ${anchor.height}`);
    console.log(`  merkleListRoot: ${anchor.validatorListHash}`);
    console.log(`  stateRoot:      ${anchor.stateRoot}`);

    console.log("Building deploy transaction…");
    const tx = await Mina.transaction({ sender: signerPublicKey, fee }, async () => {
        AccountUpdate.fundNewAccount(signerPublicKey);
        // anchors live in deploy(); the permissionless initialize is gone
        await contractInstance.deploy({ merkleListRoot, stateRoot, blockHeight });
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
    console.log("\n=== CONTRACT DEPLOYED ===");
    console.log(`CONTRACT_ADDRESS=${contractPublicKey.toBase58()}`);
    console.log(`CONTRACT_PRIVATE_KEY=${contractPrivateKey.toBase58()}`);
    console.log("\nAdd both lines to your .env file.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
