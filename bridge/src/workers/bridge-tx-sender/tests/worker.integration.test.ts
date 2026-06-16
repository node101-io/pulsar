/**
 * Integration tests for the Bridge TX Sender worker.
 * Verifies that off-circuit logic matches on-chain contract behavior.
 *
 * Required env vars:
 *   MINA_NETWORK=devnet|lightnet|mainnet
 *   CONTRACT_ADDRESS=B62q...
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";
import { Field } from "o1js";

const network = process.env.MINA_NETWORK;
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!network || !contractAddress) {
    console.warn(
        "[integration] Skipping worker tests — set MINA_NETWORK and CONTRACT_ADDRESS in .env",
    );
}

const skip = !network || !contractAddress;

import {
    initMinaClientContext,
    getContractActionListHash,
    getContractActionState,
    fetchActionsByHeight,
    getLatestMinaHeight,
    type MinaClientContext,
} from "../../../services/mina/client.js";

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

import {
    PulsarAction,
} from "../../../../../contracts/build/src/types/PulsarAction.js";

import { buildBatchAndMask, computeActionListHash } from "../worker.js";

describe.skipIf(skip)("Bridge TX Sender worker — live network", () => {
    let ctx: MinaClientContext;
    let latestHeight: number;
    let archiveAvailable: boolean;

    beforeAll(async () => {
        ctx = await initMinaClientContext();
        latestHeight = await getLatestMinaHeight(ctx);
        archiveAvailable = await isArchiveReachable(ctx.archiveEndpoint);
        if (!archiveAvailable) {
            console.warn(`[integration] Archive endpoint unreachable (${ctx.archiveEndpoint}) — archive tests will be soft-skipped`);
        }
    }, 300_000);

    // --- PulsarAction parsing ---

    it("PulsarAction.fromRawAction correctly parses raw archive field arrays", async () => {
        if (!archiveAvailable) { console.warn("[integration] Archive not reachable — skipping"); return; }
        const fromHeight = Math.max(1, latestHeight - 500);
        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        if (entries.length === 0) {
            console.warn("[integration] No actions found in range — skipping parse check");
            return;
        }

        for (const entry of entries) {
            for (const rawAction of entry.actions) {
                const parsed = PulsarAction.fromRawAction(rawAction);

                const typeNum = Number(parsed.type.toString());
                expect([1, 2]).toContain(typeNum);
                expect(PulsarAction.isDummy(parsed).toBoolean()).toBe(false);
            }
        }
    });

    // --- buildBatchAndMask ---

    it("buildBatchAndMask pads archive actions to BATCH_SIZE correctly", async () => {
        if (!archiveAvailable) { console.warn("[integration] Archive not reachable — skipping"); return; }
        const fromHeight = Math.max(1, latestHeight - 500);
        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        if (entries.length === 0) {
            console.warn("[integration] No actions found — skipping batch test");
            return;
        }

        const allActions = entries.flatMap((e) =>
            e.actions.map((raw) => PulsarAction.fromRawAction(raw)),
        );

        const slice = allActions.slice(0, 10);
        const { batch, mask } = buildBatchAndMask(slice);

        expect(batch.actions).toHaveLength(60);
        for (let i = 0; i < slice.length; i++) {
            expect(PulsarAction.isDummy(batch.actions[i]).toBoolean()).toBe(false);
            expect(mask.list[i].toBoolean()).toBe(true);
        }
        for (let i = slice.length; i < 60; i++) {
            expect(PulsarAction.isDummy(batch.actions[i]).toBoolean()).toBe(true);
            expect(mask.list[i].toBoolean()).toBe(false);
        }
    });

    // --- computeActionListHash consistency ---

    it("computeActionListHash is stable across two calls with the same data", async () => {
        if (!archiveAvailable) { console.warn("[integration] Archive not reachable — skipping"); return; }
        const fromHeight = Math.max(1, latestHeight - 500);
        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        if (entries.length === 0) {
            console.warn("[integration] No actions found — skipping hash stability test");
            return;
        }

        const actions = entries
            .flatMap((e) => e.actions.map((raw) => PulsarAction.fromRawAction(raw)))
            .slice(0, 5);

        const { batch, mask } = buildBatchAndMask(actions);
        const startHash = Field(getContractActionListHash(ctx));

        const h1 = computeActionListHash(startHash, batch, mask);
        const h2 = computeActionListHash(startHash, batch, mask);

        expect(h1.toString()).toBe(h2.toString());
    });

    it("computeActionListHash produces a different value for different action sets", async () => {
        if (!archiveAvailable) { console.warn("[integration] Archive not reachable — skipping"); return; }
        const fromHeight = Math.max(1, latestHeight - 500);
        const entries = await fetchActionsByHeight(fromHeight, latestHeight, ctx);

        if (entries.length < 2) {
            console.warn("[integration] Fewer than 2 actions — skipping diff hash test");
            return;
        }

        const allActions = entries.flatMap((e) =>
            e.actions.map((raw) => PulsarAction.fromRawAction(raw)),
        );

        const startHash = Field(0);
        const { batch: b1, mask: m1 } = buildBatchAndMask([allActions[0]]);
        const { batch: b2, mask: m2 } = buildBatchAndMask([allActions[1]]);

        if (allActions[0].type.toString() === allActions[1].type.toString() &&
            allActions[0].amount.toString() === allActions[1].amount.toString()) {
            console.warn("[integration] Two actions are identical — skipping diff hash test");
            return;
        }

        const h1 = computeActionListHash(startHash, b1, m1);
        const h2 = computeActionListHash(startHash, b2, m2);

        expect(h1.toString()).not.toBe(h2.toString());
    });

    it("off-circuit actionListHash matches on-chain value when contract has not been reduced", async () => {
        const onChainActionListHash = getContractActionListHash(ctx);
        const onChainActionState = getContractActionState(ctx);

        const isNeverReduced = onChainActionListHash === Field(0).toString();

        if (isNeverReduced) {
            const { batch, mask } = buildBatchAndMask([]);
            const computed = computeActionListHash(Field(0), batch, mask);
            expect(computed.toString()).toBe(Field(0).toString());
            return;
        }

        expect(() => BigInt(onChainActionListHash)).not.toThrow();
        expect(onChainActionListHash).not.toBe("0");
        expect(onChainActionState).not.toBe("0");

        console.info("[integration] Contract has been reduced, on-chain actionListHash:", onChainActionListHash);
    });
});
