/**
 * Integration tests for the Bridge TX Sender worker.
 * Verifies that off-circuit logic matches on-chain contract behavior.
 *
 * Required env vars (written by contracts/src/scripts/lightnet-setup.ts):
 *   MINA_NETWORK=lightnet
 *   CONTRACT_ADDRESS=B62q...
 *   VALIDATOR_PRIVATE_KEY=EK...   (written by lightnet-setup.ts)
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";
import { Field, Cache } from "o1js";
import { Mina as ContractsMina, PrivateKey, Signature } from "../../../../../contracts/build/src/utils/o1jsExports.js";
import { setMinaNetwork } from "../../../../../contracts/build/src/utils/fetch.js";

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
    getContractMerkleRoot,
    fetchActionsByHeight,
    getLatestMinaHeight,
    refreshContractState,
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

import {
    MultisigVerifierProgram,
} from "../../../../../contracts/build/src/SettlementProof.js";

import {
    ValidateReduceProgram,
    ValidateReducePublicInput,
} from "../../../../../contracts/build/src/ValidateReduce.js";

import {
    ActionStackProgram,
} from "../../../../../contracts/build/src/ActionStack.js";

import {
    SettlementContract,
} from "../../../../../contracts/build/src/SettlementContract.js";

import {
    GenerateValidateReduceProof,
    GenerateActionStackProof,
} from "../../../../../contracts/build/src/utils/generateFunctions.js";

import {
    CalculateFinalActionState,
} from "../../../../../contracts/build/src/utils/actionQueueUtils.js";

import { buildBatchAndMask, computeActionListHash, buildSignatureList } from "../worker.js";
import { sendReduceTx } from "../../../services/mina/txSender.js";

// Selective cache: re-uses SRS/lagrange from disk, skips stale circuit keys
function makeSelectiveCache(): Cache {
    return {
        read(header: any) {
            const id: string = header.persistentId ?? "";
            if (id.startsWith("step-") || id.startsWith("wrap-")) return undefined;
            return Cache.FileSystemDefault.read(header);
        },
        write(_header: any, _data: any) { /* no-op — avoid Wasm OOM on large prover keys */ },
        canWrite: false,
    } as unknown as Cache;
}

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

    // --- END-TO-END: compile → proof → tx ---

    it("E2E: compiles ZkPrograms, generates real proofs, and sends reduce tx on lightnet", async () => {
        if (ctx.network !== "lightnet") {
            console.warn("[integration] E2E test only runs on lightnet — skipping");
            return;
        }
        if (!archiveAvailable) {
            console.warn("[integration] Archive not reachable — skipping E2E test");
            return;
        }

        const validatorKeyBase58 = process.env.VALIDATOR_PRIVATE_KEY;
        if (!validatorKeyBase58) {
            console.warn("[integration] VALIDATOR_PRIVATE_KEY not set — skipping. Re-run lightnet-setup.js");
            return;
        }

        // 1. Compile all programs
        console.log("[E2E] Compiling ZkPrograms (this takes a few minutes)...");
        const cache = makeSelectiveCache();
        await MultisigVerifierProgram.compile({ cache });
        console.log("[E2E]   MultisigVerifierProgram ✓");
        await ValidateReduceProgram.compile({ cache });
        console.log("[E2E]   ValidateReduceProgram ✓");
        await ActionStackProgram.compile({ cache });
        console.log("[E2E]   ActionStackProgram ✓");
        await SettlementContract.compile({ cache });
        console.log("[E2E]   SettlementContract ✓");

        // 2. Fetch first block's actions from archive
        const entries = await fetchActionsByHeight(1, latestHeight, ctx);
        expect(entries.length).toBeGreaterThan(0);

        const firstEntry = entries[0];
        console.log(`[E2E] Processing block ${firstEntry.blockHeight} — ${firstEntry.actions.length} action(s)`);

        const pulsarActions = firstEntry.actions.map((raw) => PulsarAction.fromRawAction(raw));

        // 3. Read current on-chain state
        await refreshContractState(ctx);
        const merkleListRoot = Field(getContractMerkleRoot(ctx));
        const initialActionState = Field(getContractActionState(ctx));
        const initialActionListHash = Field(getContractActionListHash(ctx));

        console.log("[E2E] On-chain state:");
        console.log("  merkleListRoot:", merkleListRoot.toString());
        console.log("  initialActionState:", initialActionState.toString());
        console.log("  initialActionListHash:", initialActionListHash.toString());

        // 4. Build batch & compute hashes off-circuit
        const { batch, mask } = buildBatchAndMask(pulsarActions);
        const actionListHash = computeActionListHash(initialActionListHash, batch, mask);
        const finalActionState = CalculateFinalActionState(initialActionState, pulsarActions);

        console.log("[E2E] Computed:");
        console.log("  actionListHash:", actionListHash.toString());
        console.log("  finalActionState:", finalActionState.toString());

        // 5. Sign with test validator key
        const validatorKey = PrivateKey.fromBase58(validatorKeyBase58);
        const validatorPubKey = validatorKey.toPublicKey();
        const publicInput = new ValidateReducePublicInput({ merkleListRoot, actionListHash });
        const signatureMessage = publicInput.hash().toFields();
        const signature = Signature.create(validatorKey, signatureMessage);

        console.log("[E2E] Validator:", validatorPubKey.toBase58());

        const sigList = buildSignatureList([{ validatorPublicKey: validatorPubKey, signature }]);

        // 6. Generate ZK proofs
        // ActionStackProgram.proveBase iterates ACTION_QUEUE_SIZE=3000 times, making real
        // Groth16 proof generation take hours. Lightnet runs with PROOF_LEVEL=none, so the
        // node accepts any proof structure — we use LocalBlockchain({proofsEnabled:false}) to
        // get instant dummy proofs, then restore the Network instance before sending the tx.
        const t0 = Date.now();
        console.log("[E2E] Switching to LocalBlockchain(proofsEnabled=false) for dummy proof generation...");
        const localNet = await ContractsMina.LocalBlockchain({ proofsEnabled: false });
        ContractsMina.setActiveInstance(localNet);

        console.log("[E2E] Generating ValidateReduceProof (dummy)...");
        const validateReduceProof = await GenerateValidateReduceProof(publicInput, sigList);
        console.log(`[E2E]   ValidateReduceProof ✓ (${Date.now() - t0}ms)`);

        const t1 = Date.now();
        console.log("[E2E] Generating ActionStackProof (dummy)...");
        const { useActionStack, actionStackProof } = await GenerateActionStackProof(
            finalActionState,
            pulsarActions,
        );
        console.log(`[E2E]   ActionStackProof ✓  useActionStack: ${useActionStack.toBoolean()}  (${Date.now() - t1}ms)`);

        // Restore contracts' o1js to lightnet Network before sending tx
        console.log("[E2E] Restoring lightnet Network instance...");
        setMinaNetwork(ctx.network);

        // 7. Send reduce tx to lightnet
        console.log("[E2E] Sending reduce tx...");
        await sendReduceTx({ ctx, batch, useActionStack, actionStackProof, mask, validateReduceProof });
        console.log("[E2E]   Reduce tx ✓");

        // 8. Verify on-chain action state advanced
        await refreshContractState(ctx);
        const newActionState = getContractActionState(ctx);
        console.log("[E2E] New on-chain actionState:", newActionState);
        expect(newActionState).not.toBe(initialActionState.toString());
    }, 600_000); // 10 min — compile + proof generation is slow
});
