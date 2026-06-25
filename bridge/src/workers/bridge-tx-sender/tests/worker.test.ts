import { describe, it, expect, vi, beforeEach } from "vitest";
import { Field, Bool } from "o1js";

// paths relative to src/workers/bridge-tx-sender/tests/
// bridge-internal:  ../../../X     (3 up = src/)
// worker itself:    ../worker.js   (1 up)
// contracts:        ../../../../../contracts/build/src/X  (5 up = pulsar/ root)

// ---------------------------------------------------------------------------
// Mock boundaries
//
// We keep the *pure* contract helpers real (PulsarAction, Batch, ReduceMask,
// SignaturePublicKeyList, ValidateReducePublicInput, constants) so that
// buildBatchAndMask / computeActionListHash / buildSignatureList exercise the
// same o1js code paths the contract uses.
//
// We mock the *heavy / IO* boundaries: ZK proof generation, the Mina tx
// sender, the validator signature request, the Mina client and the DB models.
//
// TODO(pulsar): the validator signature flow (requestSignatures payload +
// buildSignatureList validator-set / padding) is still undefined — it depends
// on the Pulsar/prover spec. Once that lands, replace the mocked
// requestSignatures contract and the it.todo() cases below with real ones.
// ---------------------------------------------------------------------------

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
    mockGenerateActionStackProof,
    mockCalculateFinalActionState,
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
    mockGenerateActionStackProof: vi.fn(),
    mockCalculateFinalActionState: vi.fn(),
}));

vi.mock("../../../../../contracts/build/src/utils/generateFunctions.js", () => ({
    GenerateValidateReduceProof: mockGenerateValidateReduceProof,
    GenerateActionStackProof: mockGenerateActionStackProof,
}));

vi.mock("../../../../../contracts/build/src/utils/actionQueueUtils.js", () => ({
    CalculateFinalActionState: mockCalculateFinalActionState,
}));

// Keep BATCH_SIZE / VALIDATOR_NUMBER real, just pass through.
vi.mock("../../../../../contracts/build/src/utils/constants.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../../contracts/build/src/utils/constants.js")>();
    return { ...actual };
});

// Avoid the expensive real dummy-proof generation — worker only needs an opaque
// object to hand to proveReduceTx (which is mocked).
vi.mock("../../../../../contracts/build/src/ActionStack.js", () => ({
    ActionStackProof: {
        dummy: vi.fn().mockResolvedValue({ __mock: "dummy-stack-proof" }),
    },
}));

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

import {
    worker,
    computeActionListHash,
    buildBatchAndMask,
    buildSignatureList,
} from "../worker.js";

import {
    PulsarAction,
    PulsarAuth,
    CosmosSignature,
} from "../../../../../contracts/build/src/types/PulsarAction.js";
import { ReduceMask } from "../../../../../contracts/build/src/types/common.js";
import { VALIDATOR_NUMBER, BATCH_SIZE } from "../../../../../contracts/build/src/utils/constants.js";
import { PublicKey, Signature } from "o1js";

// --- helpers ---

function makeDepositAction() {
    return PulsarAction.deposit(
        PublicKey.empty(),
        Field(1_000_000_000n),
        new PulsarAuth({
            cosmosAddress: Field(42),
            cosmosSignature: new CosmosSignature({ r: Field(1), s: Field(2) }),
        }),
    );
}

function makeWithdrawAction() {
    return PulsarAction.withdrawal(PublicKey.empty(), Field(500_000_000n));
}

// [type, x, isOdd, amount, cosmosAddress, r, s]
const rawDeposit = ["1", "0", "0", "1000000000", "42", "1", "2"];

function makeValidatorSigs(n: number) {
    return Array.from({ length: n }, () => ({
        validatorPublicKey: PublicKey.empty(),
        signature: Signature.empty(),
    }));
}

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("buildBatchAndMask", () => {
    it("pads actions to BATCH_SIZE with dummy entries", () => {
        const { batch } = buildBatchAndMask([makeDepositAction()]);
        expect(batch.actions).toHaveLength(BATCH_SIZE);
        expect(PulsarAction.isDummy(batch.actions[0]).toBoolean()).toBe(false);
        expect(PulsarAction.isDummy(batch.actions[1]).toBoolean()).toBe(true);
    });

    it("sets mask true only for real actions", () => {
        const { mask } = buildBatchAndMask([makeDepositAction(), makeWithdrawAction()]);
        expect(mask.list[0].toBoolean()).toBe(true);
        expect(mask.list[1].toBoolean()).toBe(true);
        expect(mask.list[2].toBoolean()).toBe(false);
        expect(mask.list[BATCH_SIZE - 1].toBoolean()).toBe(false);
    });

    it("throws when actions exceed BATCH_SIZE", () => {
        const actions = Array(BATCH_SIZE + 1).fill(makeDepositAction());
        expect(() => buildBatchAndMask(actions)).toThrow("exceeds BATCH_SIZE");
    });

    it("handles empty action list", () => {
        const { batch, mask } = buildBatchAndMask([]);
        expect(batch.actions.every((a) => PulsarAction.isDummy(a).toBoolean())).toBe(true);
        expect(mask.list.every((b) => !b.toBoolean())).toBe(true);
    });
});

describe("computeActionListHash", () => {
    it("returns startHash unchanged when all actions are dummy", () => {
        const { batch, mask } = buildBatchAndMask([]);
        expect(computeActionListHash(Field(12345), batch, mask).toString()).toBe("12345");
    });

    it("produces a different hash when a real action is included", () => {
        const { batch, mask } = buildBatchAndMask([makeDepositAction()]);
        expect(computeActionListHash(Field(0), batch, mask).toString()).not.toBe("0");
    });

    it("is deterministic — same inputs produce same hash", () => {
        const { batch, mask } = buildBatchAndMask([makeDepositAction(), makeWithdrawAction()]);
        const h1 = computeActionListHash(Field(7), batch, mask);
        const h2 = computeActionListHash(Field(7), batch, mask);
        expect(h1.toString()).toBe(h2.toString());
    });

    it("mask=false skips action so hash stays at startHash", () => {
        const { batch } = buildBatchAndMask([makeDepositAction()]);
        const maskOff = ReduceMask.fromArray(Array(BATCH_SIZE).fill(false));
        const maskOn = ReduceMask.fromArray([true, ...Array(BATCH_SIZE - 1).fill(false)]);
        expect(computeActionListHash(Field(0), batch, maskOff).toString()).toBe("0");
        expect(computeActionListHash(Field(0), batch, maskOn).toString()).not.toBe("0");
    });

    it("deposit and withdrawal produce different hashes", () => {
        const { batch: b1, mask: m1 } = buildBatchAndMask([makeDepositAction()]);
        const { batch: b2, mask: m2 } = buildBatchAndMask([makeWithdrawAction()]);
        expect(computeActionListHash(Field(0), b1, m1).toString()).not.toBe(
            computeActionListHash(Field(0), b2, m2).toString(),
        );
    });

    it("chaining hashes accumulates state — order matters", () => {
        const a1 = makeDepositAction();
        const a2 = makeWithdrawAction();
        const { batch: bAB, mask: mAB } = buildBatchAndMask([a1, a2]);
        const { batch: bBA, mask: mBA } = buildBatchAndMask([a2, a1]);
        expect(computeActionListHash(Field(0), bAB, mAB).toString()).not.toBe(
            computeActionListHash(Field(0), bBA, mBA).toString(),
        );
    });
});

describe("buildSignatureList", () => {
    it("builds a list of length VALIDATOR_NUMBER from a full set of sigs", () => {
        const list = buildSignatureList(makeValidatorSigs(VALIDATOR_NUMBER));
        expect(list.list).toHaveLength(VALIDATOR_NUMBER);
    });

    it("truncates when more than VALIDATOR_NUMBER signatures are provided", () => {
        const list = buildSignatureList(makeValidatorSigs(VALIDATOR_NUMBER + 2));
        expect(list.list).toHaveLength(VALIDATOR_NUMBER);
    });

    // TODO(pulsar): when fewer than VALIDATOR_NUMBER validators respond, the
    // missing slots currently get null-padded, which cannot satisfy the
    // on-chain merkleListRoot reconstruction in ValidateReduceProgram. The
    // correct behavior (fill with the real, non-signing validators' public
    // keys + empty signatures) depends on how the Pulsar validator set is
    // sourced. Locked once the Pulsar spec lands.
    it.todo("pads missing validators with the real validator-set public keys");
});

// ===========================================================================
// worker() — orchestration
// ===========================================================================

describe("worker()", () => {
    const mockCtx = {
        contractAddress: PublicKey.empty(),
        contract: {},
        network: "devnet",
        nodeEndpoint: "https://node",
        archiveEndpoint: "https://archive",
        zkappState: [],
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitCtx.mockResolvedValue(mockCtx);
        mockRefreshContractState.mockResolvedValue(undefined);
        mockGetMerkleRoot.mockReturnValue("100");
        mockGetActionState.mockReturnValue("200");
        mockGetActionListHash.mockReturnValue("0");
        mockMinaActionUpdateOne.mockResolvedValue({});
        mockBridgeStateUpdateOne.mockResolvedValue({});
        mockRequestSignatures.mockResolvedValue(makeValidatorSigs(VALIDATOR_NUMBER));
        mockGenerateValidateReduceProof.mockResolvedValue({ __mock: "reduce-proof" });
        mockGenerateActionStackProof.mockResolvedValue({
            useActionStack: Bool(true),
            actionStackProof: { __mock: "stack-proof" },
        });
        mockCalculateFinalActionState.mockReturnValue(Field(999));
        mockProveReduceTx.mockResolvedValue('{"provedTx":true}');
        mockSendProvedReduceTx.mockResolvedValue(undefined);
    });

    // --- guard clauses ---

    it("throws when block not found in DB", async () => {
        mockMinaActionFindOne.mockResolvedValue(null);
        await expect(worker({ blockHeight: 50, actions: [] })).rejects.toThrow("not found");
    });

    it("returns early without sending TX when block is already done", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "done", failCount: 0 });
        await worker({ blockHeight: 50, actions: [rawDeposit] });
        expect(mockProveReduceTx).not.toHaveBeenCalled();
        expect(mockSendProvedReduceTx).not.toHaveBeenCalled();
    });

    it("returns early without sending TX when failCount >= MAX_FAIL_COUNT", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "submitted", failCount: 3 });
        await worker({ blockHeight: 50, actions: [rawDeposit] });
        expect(mockProveReduceTx).not.toHaveBeenCalled();
    });

    it("processes when failCount is below MAX_FAIL_COUNT", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 2 });
        await worker({ blockHeight: 50, actions: [rawDeposit] });
        expect(mockProveReduceTx).toHaveBeenCalledOnce();
    });

    // --- single-batch path (actions <= BATCH_SIZE): direct reduce tx ---

    describe("single batch (actions <= BATCH_SIZE)", () => {
        beforeEach(() => {
            mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });
        });

        it("proves and sends exactly one reduce TX", async () => {
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockProveReduceTx).toHaveBeenCalledOnce();
            expect(mockSendProvedReduceTx).toHaveBeenCalledOnce();
        });

        it("does NOT generate an action-stack proof (uses dummy, useActionStack=false)", async () => {
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockGenerateActionStackProof).not.toHaveBeenCalled();
            const call = mockProveReduceTx.mock.calls[0][0];
            expect(call.useActionStack.toBoolean()).toBe(false);
        });

        it("passes ctx, batch, mask and the reduce proof to proveReduceTx", async () => {
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            const call = mockProveReduceTx.mock.calls[0][0];
            expect(call.ctx).toBe(mockCtx);
            expect(call.batch.actions).toHaveLength(BATCH_SIZE);
            expect(call.mask).toBeDefined();
            expect(call.validateReduceProof).toEqual({ __mock: "reduce-proof" });
            expect(call.upToMinaHeight).toBe(50);
        });

        it("requests signatures with the on-chain initial/final action state", async () => {
            mockGetActionState.mockReturnValue("12345");
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockRequestSignatures).toHaveBeenCalledWith("12345", "999");
        });

        it("marks the block done and advances lastSubmittedHeight on success", async () => {
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
                { blockHeight: 50 },
                { $set: { status: "done" } },
            );
            expect(mockBridgeStateUpdateOne).toHaveBeenCalledWith(
                {},
                { $set: { lastSubmittedHeight: 50 } },
            );
        });

        it("skips sending when proveReduceTx reports the height is already on-chain", async () => {
            mockProveReduceTx.mockResolvedValue(null);
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockSendProvedReduceTx).not.toHaveBeenCalled();
            // still marks done — nothing left to do for this height
            expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
                { blockHeight: 50 },
                { $set: { status: "done" } },
            );
        });

        it("does not refresh contract state again after the initial refresh", async () => {
            await worker({ blockHeight: 50, actions: [rawDeposit] });
            expect(mockRefreshContractState).toHaveBeenCalledOnce();
        });
    });

    // --- chunk path (actions > BATCH_SIZE): proof per chunk ---

    describe("chunked (actions > BATCH_SIZE)", () => {
        beforeEach(() => {
            mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });
        });

        it("splits into chunks and sends one reduce TX per chunk", async () => {
            // BATCH_SIZE + 1 actions -> 2 chunks (BATCH_SIZE, 1)
            const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);
            await worker({ blockHeight: 77, actions });
            expect(mockProveReduceTx).toHaveBeenCalledTimes(2);
            expect(mockSendProvedReduceTx).toHaveBeenCalledTimes(2);
        });

        it("generates an action-stack proof for each chunk", async () => {
            const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);
            await worker({ blockHeight: 77, actions });
            expect(mockGenerateActionStackProof).toHaveBeenCalledTimes(2);
        });

        it("forwards the generated useActionStack flag and proof to proveReduceTx", async () => {
            const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);
            await worker({ blockHeight: 77, actions });
            const call = mockProveReduceTx.mock.calls[0][0];
            expect(call.useActionStack.toBoolean()).toBe(true);
            expect(call.actionStackProof).toEqual({ __mock: "stack-proof" });
        });

        it("refreshes contract state between chunks (initial + 1 between)", async () => {
            const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);
            await worker({ blockHeight: 77, actions });
            // initial refresh (1) + one refresh between the two chunks (1)
            expect(mockRefreshContractState).toHaveBeenCalledTimes(2);
        });

        it("marks the block done only after all chunks are processed", async () => {
            const actions = Array(BATCH_SIZE + 1).fill(rawDeposit);
            await worker({ blockHeight: 77, actions });
            expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
                { blockHeight: 77 },
                { $set: { status: "done" } },
            );
        });
    });
});
