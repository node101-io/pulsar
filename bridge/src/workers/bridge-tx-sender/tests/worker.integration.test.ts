/**
 * Integration test for the Bridge TX Sender worker — REAL proof generation.
 *
 * Goal: verify the worker's core logic end-to-end *without* a Mina node and
 * *without* sending a transaction. We mock the Mina blockchain boundary
 * (client + txSender) and the pending-pulsar signature flow
 * (requestSignatures + GenerateValidateReduceProof), but run the
 * ActionStackProof generation FOR REAL (compiled ActionStackProgram).
 *
 * This answers: "does the worker take incoming actions, batch them, and
 * generate the action-stack proof correctly?"
 *
 * Heavy: compiles ActionStackProgram and runs real proveBase proofs.
 * Run with: npm run test:integration
 *
 * TODO(pulsar): GenerateValidateReduceProof + requestSignatures are mocked
 * because the validator signature flow is undefined until the Pulsar spec
 * lands. Once it does, wire in a real ValidateReduceProof here too.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Bool, Field, Cache } from "o1js";

// contracts:  ../../../../../contracts/build/src/X   (5 up = pulsar/ root)

const {
    mockMinaActionFindOne,
    mockMinaActionUpdateOne,
    mockBridgeStateUpdateOne,
    mockInitCtx,
    mockRefreshContractState,
    mockGetMerkleRoot,
    mockGetActionState,
    mockGetActionListHash,
    mockRequestSignatures,
    mockProveReduceTx,
    mockSendProvedReduceTx,
    mockGenerateValidateReduceProof,
} = vi.hoisted(() => ({
    mockMinaActionFindOne: vi.fn(),
    mockMinaActionUpdateOne: vi.fn(),
    mockBridgeStateUpdateOne: vi.fn(),
    mockInitCtx: vi.fn(),
    mockRefreshContractState: vi.fn(),
    mockGetMerkleRoot: vi.fn(),
    mockGetActionState: vi.fn(),
    mockGetActionListHash: vi.fn(),
    mockRequestSignatures: vi.fn(),
    mockProveReduceTx: vi.fn(),
    mockSendProvedReduceTx: vi.fn(),
    mockGenerateValidateReduceProof: vi.fn(),
}));

// Keep GenerateActionStackProof REAL — only stub the pulsar-dependent
// GenerateValidateReduceProof.
vi.mock("../../../../../contracts/build/src/utils/generateFunctions.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../../contracts/build/src/utils/generateFunctions.js")>();
    return {
        ...actual,
        GenerateValidateReduceProof: mockGenerateValidateReduceProof,
    };
});

vi.mock("../../../common/logger.js", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../db/models/MinaAction.js", () => ({
    MinaActionModel: {
        findOne: mockMinaActionFindOne,
        updateOne: mockMinaActionUpdateOne,
    },
}));

vi.mock("../../../db/models/BridgeState.js", () => ({
    BridgeStateModel: { updateOne: mockBridgeStateUpdateOne },
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: mockInitCtx,
    refreshContractState: mockRefreshContractState,
    getContractMerkleRoot: mockGetMerkleRoot,
    getContractActionState: mockGetActionState,
    getContractActionListHash: mockGetActionListHash,
}));

vi.mock("../../../services/pulsar/client.js", () => ({
    requestSignatures: mockRequestSignatures,
}));

vi.mock("../../../services/mina/txSender.js", () => ({
    proveReduceTx: mockProveReduceTx,
    sendProvedReduceTx: mockSendProvedReduceTx,
}));

vi.mock("../../../config/constants.js", () => ({
    MAX_FAIL_COUNT: 3,
}));

import { worker } from "../worker.js";
import { ActionStackProgram } from "../../../../../contracts/build/src/ActionStack.js";
import { BATCH_SIZE } from "../../../../../contracts/build/src/utils/constants.js";
import { PublicKey, Signature } from "o1js";

// [type, x, isOdd, amount, cosmosAddress, r, s]
const rawDeposit = ["1", "0", "0", "1000000000", "42", "1", "2"];

describe("Bridge TX Sender worker — real ActionStackProof generation", () => {
    const mockCtx = {
        contractAddress: PublicKey.empty(),
        contract: {},
        network: "devnet",
        nodeEndpoint: "https://node",
        archiveEndpoint: "https://archive",
        zkappState: [],
    } as any;

    beforeAll(async () => {
        // Required before GenerateActionStackProof can call proveBase.
        console.log("[integration] Compiling ActionStackProgram...");
        const t0 = Date.now();
        await ActionStackProgram.compile({ cache: Cache.FileSystemDefault });
        console.log(`[integration] ActionStackProgram compiled (${Date.now() - t0}ms)`);
    }, 300_000);

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitCtx.mockResolvedValue(mockCtx);
        mockRefreshContractState.mockResolvedValue(undefined);
        mockGetMerkleRoot.mockReturnValue("100");
        mockGetActionState.mockReturnValue("0");
        mockGetActionListHash.mockReturnValue("0");
        mockMinaActionUpdateOne.mockResolvedValue({});
        mockBridgeStateUpdateOne.mockResolvedValue({});
        mockRequestSignatures.mockResolvedValue([
            { validatorPublicKey: PublicKey.empty(), signature: Signature.empty() },
        ]);
        // pending-pulsar: real ValidateReduceProof is wired in later
        mockGenerateValidateReduceProof.mockResolvedValue({ __mock: "validate-reduce-proof" });
        mockProveReduceTx.mockResolvedValue('{"provedTx":true}');
        mockSendProvedReduceTx.mockResolvedValue(undefined);
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });
    });

    it("batches > BATCH_SIZE actions into chunks and generates a real ActionStackProof per chunk", async () => {
        // BATCH_SIZE + 1 -> 2 chunks (BATCH_SIZE, 1)
        const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);

        await worker({ blockHeight: 100, actions });

        // one reduce tx prepared per chunk
        expect(mockProveReduceTx).toHaveBeenCalledTimes(2);

        // --- debug: dump each chunk's generated proof so we can eyeball that
        //     real ActionStackProofs were produced ---
        console.log(`\n[debug] ${actions.length} actions -> ${mockProveReduceTx.mock.calls.length} reduce tx(s)`);
        mockProveReduceTx.mock.calls.forEach(([params], i) => {
            const realActions = params.batch.actions.filter(
                (a: any) => a.type.toString() !== "0",
            ).length;
            console.log(`[debug] chunk #${i}:`);
            console.log(`[debug]   batch size (padded):   ${params.batch.actions.length}`);
            console.log(`[debug]   real actions in batch:  ${realActions}`);
            console.log(`[debug]   useActionStack:         ${params.useActionStack.toBoolean()}`);
            console.log(`[debug]   actionStackProof.publicInput:  ${params.actionStackProof.publicInput.toString()}`);
            console.log(`[debug]   actionStackProof.publicOutput: ${params.actionStackProof.publicOutput.toString()}`);
            console.log(`[debug]   maxProofsVerified:      ${params.actionStackProof.maxProofsVerified}`);
            const proofLen = params.actionStackProof.proof?.length ?? params.actionStackProof.proof?.toString().length;
            console.log(`[debug]   proof payload length:   ${proofLen}`);
        });
        console.log("");

        // each chunk produced a REAL ActionStackProof (has Zk proof public IO)
        for (const [params] of mockProveReduceTx.mock.calls) {
            expect(params.actionStackProof).toBeDefined();
            expect(params.actionStackProof.publicInput).toBeDefined();
            expect(params.actionStackProof.publicOutput).toBeDefined();
            // a real proof carries a non-empty serialized payload
            expect(params.actionStackProof.proof).toBeTruthy();
            // batch must be padded to BATCH_SIZE
            expect(params.batch.actions).toHaveLength(BATCH_SIZE);
        }

        // useActionStack must be true whenever un-reduced actions remain, false
        // only on the final chunk (no leftover). 61 actions -> chunks [60, 1]:
        //   chunk #0: 1 action remaining  -> true
        //   chunk #1: 0 actions remaining -> false
        const chunk0 = mockProveReduceTx.mock.calls[0][0];
        const chunk1 = mockProveReduceTx.mock.calls[1][0];
        expect(chunk0.useActionStack.toBoolean()).toBe(true);
        expect(chunk1.useActionStack.toBoolean()).toBe(false);

        // block flagged done only after both chunks succeed
        expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
            { blockHeight: 100 },
            { $set: { status: "done" } },
        );
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledWith(
            {},
            { $set: { lastSubmittedHeight: 100 } },
        );
    }, 600_000);

    it("130 actions -> 3 chunks, exercises proveRecursive and the useActionStack pattern [true, true, false]", async () => {
        // 130 actions -> chunkArray(130, 60) = [60, 60, 10] -> 3 reduce tx(s)
        //   chunk #0: 70 remaining -> proveBase + proveRecursive, useActionStack=true
        //   chunk #1: 10 remaining -> proveBase only,             useActionStack=true
        //   chunk #2:  0 remaining -> no stack,                   useActionStack=false
        const actions = Array(130).fill(rawDeposit);

        await worker({ blockHeight: 130, actions });

        expect(mockProveReduceTx).toHaveBeenCalledTimes(3);

        console.log(`\n[debug] ${actions.length} actions -> ${mockProveReduceTx.mock.calls.length} reduce tx(s)`);
        const remainingPerChunk = [70, 10, 0];
        mockProveReduceTx.mock.calls.forEach(([params], i) => {
            const realActions = params.batch.actions.filter(
                (a: any) => a.type.toString() !== "0",
            ).length;
            console.log(`[debug] chunk #${i} (remaining=${remainingPerChunk[i]}):`);
            console.log(`[debug]   real actions in batch:  ${realActions}`);
            console.log(`[debug]   useActionStack:         ${params.useActionStack.toBoolean()}`);
            console.log(`[debug]   actionStackProof.publicInput:  ${params.actionStackProof.publicInput.toString()}`);
            console.log(`[debug]   actionStackProof.publicOutput: ${params.actionStackProof.publicOutput.toString()}`);
            console.log(`[debug]   maxProofsVerified:      ${params.actionStackProof.maxProofsVerified}`);
        });
        console.log("");

        const flags = mockProveReduceTx.mock.calls.map(
            ([p]) => p.useActionStack.toBoolean(),
        );
        expect(flags).toEqual([true, true, false]);

        for (const [params] of mockProveReduceTx.mock.calls) {
            expect(params.actionStackProof.proof).toBeTruthy();
            expect(params.batch.actions).toHaveLength(BATCH_SIZE);
        }

        expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
            { blockHeight: 130 },
            { $set: { status: "done" } },
        );
    }, 600_000);

    it("single batch (<= BATCH_SIZE) prepares exactly one reduce tx with useActionStack=false", async () => {
        const actions = Array(10).fill(rawDeposit);

        await worker({ blockHeight: 101, actions });

        expect(mockProveReduceTx).toHaveBeenCalledOnce();
        const params = mockProveReduceTx.mock.calls[0][0];
        expect(params.useActionStack.toBoolean()).toBe(false);
        expect(params.batch.actions).toHaveLength(BATCH_SIZE);
    }, 120_000);
});
