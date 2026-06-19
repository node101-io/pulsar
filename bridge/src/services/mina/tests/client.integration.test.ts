/**
 * Integration tests — require a live Mina node and archive.
 * Set these env vars before running:
 *
 *   MINA_NETWORK=devnet|lightnet|mainnet
 *   CONTRACT_ADDRESS=B62q...
 *
 * Optional (defaults to constants.ts ENDPOINTS):
 *   LIGHTNET_NODE_URL=http://...
 *   LIGHTNET_ARCHIVE_URL=http://...
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";

const network = process.env.MINA_NETWORK;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!network || !contractAddress) {
    console.warn(
        "[integration] Skipping Mina client tests — set MINA_NETWORK and CONTRACT_ADDRESS in .env",
    );
}

const skip = !network || !contractAddress;

import {
    initMinaClientContext,
    getLatestMinaHeight,
    getContractMerkleRoot,
    getContractActionState,
    getContractActionListHash,
    fetchActionsByHeight,
    type MinaClientContext,
} from "../client.js";

async function isArchiveReachable(archiveEndpoint: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(archiveEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ __typename }" }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok;
    } catch {
        return false;
    }
}

describe.skipIf(skip)("Mina client — live network", () => {
    let ctx: MinaClientContext;
    let archiveAvailable: boolean;

    beforeAll(async () => {
        ctx = await initMinaClientContext();
        archiveAvailable = await isArchiveReachable(ctx.archiveEndpoint);
        if (!archiveAvailable) {
            console.warn(`[integration] Archive endpoint unreachable (${ctx.archiveEndpoint}) — archive tests will be skipped`);
        }
    }, 120_000);

    // --- connection ---

    it("initializes context with the correct network and contract address", () => {
        expect(ctx.network).toBe(network);
        expect(ctx.contractAddress.toBase58()).toBe(contractAddress);
        expect(ctx.nodeEndpoint).toBeTruthy();
        expect(ctx.archiveEndpoint).toBeTruthy();
    });

    it("fetches the latest Mina block height (positive integer)", async () => {
        const height = await getLatestMinaHeight(ctx);
        expect(height).toBeGreaterThan(0);
        expect(Number.isInteger(height)).toBe(true);
    });

    // --- contract state (read from cached zkappState, no extra network call) ---

    it("reads merkleListRoot from the deployed contract", () => {
        const root = getContractMerkleRoot(ctx);
        expect(typeof root).toBe("string");
        expect(root.length).toBeGreaterThan(0);
    });

    it("reads actionState from the deployed contract", () => {
        const state = getContractActionState(ctx);
        expect(typeof state).toBe("string");
        expect(state.length).toBeGreaterThan(0);
    });

    it("reads actionListHash from the deployed contract", () => {
        const hash = getContractActionListHash(ctx);
        expect(typeof hash).toBe("string");
        expect(hash.length).toBeGreaterThan(0);
    });

    it("all three contract state fields are parseable BigInts", () => {
        const root = getContractMerkleRoot(ctx);
        const state = getContractActionState(ctx);
        const hash = getContractActionListHash(ctx);
        expect(() => BigInt(root)).not.toThrow();
        expect(() => BigInt(state)).not.toThrow();
        expect(() => BigInt(hash)).not.toThrow();
    });

    // --- archive ---
    // archiveAvailable is set in beforeAll; guard inside each test so the flag is evaluated at runtime

    it("fetchActionsByHeight returns an array (possibly empty) for a recent range", async () => {
        if (!archiveAvailable) {
            console.warn("[integration] Archive not reachable — skipping");
            return;
        }
        const latestHeight = await getLatestMinaHeight(ctx);
        const fromHeight = Math.max(1, latestHeight - 50);

        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        expect(Array.isArray(entries)).toBe(true);
        for (const entry of entries) {
            expect(entry.blockHeight).toBeGreaterThanOrEqual(fromHeight);
            expect(entry.blockHeight).toBeLessThanOrEqual(latestHeight);
            expect(Array.isArray(entry.actions)).toBe(true);
        }
    });

    it("fetchActionsByHeight entries are sorted ascending by blockHeight", async () => {
        if (!archiveAvailable) {
            console.warn("[integration] Archive not reachable — skipping");
            return;
        }
        const latestHeight = await getLatestMinaHeight(ctx);
        const fromHeight = Math.max(1, latestHeight - 200);

        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        for (let i = 1; i < entries.length; i++) {
            expect(entries[i].blockHeight).toBeGreaterThan(entries[i - 1].blockHeight);
        }
    });

    it("raw action field arrays have the expected length (7 fields per PulsarAction)", async () => {
        if (!archiveAvailable) {
            console.warn("[integration] Archive not reachable — skipping");
            return;
        }
        const latestHeight = await getLatestMinaHeight(ctx);
        const fromHeight = Math.max(1, latestHeight - 500);

        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        for (const entry of entries) {
            for (const rawAction of entry.actions) {
                expect(rawAction).toHaveLength(7);
                for (const field of rawAction) {
                    expect(() => BigInt(field)).not.toThrow();
                }
            }
        }
    });
});
