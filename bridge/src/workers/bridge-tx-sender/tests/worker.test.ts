import { describe, it, expect, vi, beforeEach } from "vitest";
import { Field, Bool } from "o1js";

// paths relative to src/workers/bridge-tx-sender/tests/
// bridge-internal:  ../../X        (2 up = src/workers/bridge-tx-sender/ or ../../../X = src/)
// worker itself:    ../worker.js   (1 up)
// contracts:        ../../../../../contracts/build/src/X  (4 up = pulsar/ root)

vi.mock("../../../../../contracts/build/src/utils/generateFunctions.js", () => ({
    GenerateValidateReduceProof: vi.fn().mockResolvedValue({ proof: "mock-reduce-proof" }),
    GenerateActionStackProof: vi.fn().mockResolvedValue({
        useActionStack: Bool(false),
        actionStackProof: "mock-stack-proof",
    }),
}));

vi.mock("../../../../../contracts/build/src/ValidateReduce.js", () => ({
    ValidateReducePublicInput: vi.fn().mockImplementation(function(this: any, args: any) {
        Object.assign(this, args);
    }),
}));

vi.mock("../../../../../contracts/build/src/utils/actionQueueUtils.js", () => ({
    CalculateFinalActionState: vi.fn().mockReturnValue(Field(999)),
}));

vi.mock("../../../../../contracts/build/src/utils/constants.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../../contracts/build/src/utils/constants.js")>();
    return { ...actual };
});

// vi.mock factories are hoisted — declare shared mocks with vi.hoisted so they're
// available both inside the factory and in test bodies
const {
    mockMinaActionFindOne,
    mockMinaActionUpdateOne,
    mockBridgeStateUpdateOne,
    mockInitCtx,
    mockGetMerkleRoot,
    mockGetActionState,
    mockGetActionListHash,
    mockRequestSignatures,
    mockSendReduceTx,
} = vi.hoisted(() => ({
    mockMinaActionFindOne: vi.fn(),
    mockMinaActionUpdateOne: vi.fn(),
    mockBridgeStateUpdateOne: vi.fn(),
    mockInitCtx: vi.fn(),
    mockGetMerkleRoot: vi.fn().mockReturnValue("100"),
    mockGetActionState: vi.fn().mockReturnValue("200"),
    mockGetActionListHash: vi.fn().mockReturnValue("0"),
    mockRequestSignatures: vi.fn().mockResolvedValue([
        { validatorPublicKey: "B62qVal1", signature: "sig1" },
    ]),
    mockSendReduceTx: vi.fn().mockResolvedValue(undefined),
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
    getContractMerkleRoot: mockGetMerkleRoot,
    getContractActionState: mockGetActionState,
    getContractActionListHash: mockGetActionListHash,
}));

vi.mock("../../../services/pulsar/client.js", () => ({
    requestSignatures: mockRequestSignatures,
}));

vi.mock("../../../services/mina/txSender.js", () => ({
    sendReduceTx: mockSendReduceTx,
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

// --- buildBatchAndMask ---

describe("buildBatchAndMask", () => {
    it("pads actions to BATCH_SIZE with dummy entries", () => {
        const actions = [makeDepositAction()];
        const { batch } = buildBatchAndMask(actions);
        expect(batch.actions).toHaveLength(60);
        expect(PulsarAction.isDummy(batch.actions[0]).toBoolean()).toBe(false);
        expect(PulsarAction.isDummy(batch.actions[1]).toBoolean()).toBe(true);
    });

    it("sets mask true only for real actions", () => {
        const actions = [makeDepositAction(), makeWithdrawAction()];
        const { mask } = buildBatchAndMask(actions);
        expect(mask.list[0].toBoolean()).toBe(true);
        expect(mask.list[1].toBoolean()).toBe(true);
        expect(mask.list[2].toBoolean()).toBe(false);
        expect(mask.list[59].toBoolean()).toBe(false);
    });

    it("throws when actions exceed BATCH_SIZE", () => {
        const actions = Array(61).fill(makeDepositAction());
        expect(() => buildBatchAndMask(actions)).toThrow("Too many actions");
    });

    it("handles empty action list", () => {
        const { batch, mask } = buildBatchAndMask([]);
        expect(batch.actions.every((a) => PulsarAction.isDummy(a).toBoolean())).toBe(true);
        expect(mask.list.every((b) => !b.toBoolean())).toBe(true);
    });
});

// --- computeActionListHash ---

describe("computeActionListHash", () => {
    it("returns startHash unchanged when all actions are dummy", () => {
        const { batch, mask } = buildBatchAndMask([]);
        const result = computeActionListHash(Field(12345), batch, mask);
        expect(result.toString()).toBe("12345");
    });

    it("produces a different hash when a real action is included", () => {
        const { batch, mask } = buildBatchAndMask([makeDepositAction()]);
        const result = computeActionListHash(Field(0), batch, mask);
        expect(result.toString()).not.toBe("0");
    });

    it("is deterministic — same inputs produce same hash", () => {
        const actions = [makeDepositAction(), makeWithdrawAction()];
        const { batch, mask } = buildBatchAndMask(actions);
        const h1 = computeActionListHash(Field(7), batch, mask);
        const h2 = computeActionListHash(Field(7), batch, mask);
        expect(h1.toString()).toBe(h2.toString());
    });

    it("mask=false skips action so hash stays at startHash", () => {
        const { batch } = buildBatchAndMask([makeDepositAction()]);
        const maskOff = ReduceMask.fromArray(Array(60).fill(false));
        const maskOn = ReduceMask.fromArray([true, ...Array(59).fill(false)]);

        const withoutAction = computeActionListHash(Field(0), batch, maskOff);
        const withAction = computeActionListHash(Field(0), batch, maskOn);

        expect(withoutAction.toString()).toBe("0");
        expect(withAction.toString()).not.toBe("0");
    });

    it("deposit and withdrawal produce different hashes", () => {
        const { batch: b1, mask: m1 } = buildBatchAndMask([makeDepositAction()]);
        const { batch: b2, mask: m2 } = buildBatchAndMask([makeWithdrawAction()]);
        const h1 = computeActionListHash(Field(0), b1, m1);
        const h2 = computeActionListHash(Field(0), b2, m2);
        expect(h1.toString()).not.toBe(h2.toString());
    });

    it("chaining hashes accumulates state — order matters", () => {
        const a1 = makeDepositAction();
        const a2 = makeWithdrawAction();
        const { batch: bAB, mask: mAB } = buildBatchAndMask([a1, a2]);
        const { batch: bBA, mask: mBA } = buildBatchAndMask([a2, a1]);

        const hAB = computeActionListHash(Field(0), bAB, mAB);
        const hBA = computeActionListHash(Field(0), bBA, mBA);
        expect(hAB.toString()).not.toBe(hBA.toString());
    });
});

// --- buildSignatureList ---

describe("buildSignatureList", () => {
    it("builds a list with the correct length (VALIDATOR_NUMBER)", () => {
        const sigs = [{ validatorPublicKey: PublicKey.empty(), signature: Signature.empty() }];
        const list = buildSignatureList(sigs);
        expect(list.list).toHaveLength(1);
    });

    it("pads to VALIDATOR_NUMBER when fewer signatures provided", () => {
        expect(buildSignatureList([]).list).toHaveLength(1);
    });

    it("truncates when more signatures than VALIDATOR_NUMBER are provided", () => {
        const sigs = Array(5).fill({ validatorPublicKey: PublicKey.empty(), signature: Signature.empty() });
        expect(buildSignatureList(sigs).list).toHaveLength(1);
    });
});

// --- worker() behavior ---

describe("worker()", () => {
    const mockCtx = {
        contractAddress: PublicKey.empty(),
        contract: {},
        network: "devnet",
        nodeEndpoint: "https://node",
        archiveEndpoint: "https://archive",
    } as any;

    // [type, x, isOdd, amount, cosmosAddress, r, s]
    const rawAction = ["1", "0", "0", "1000000000", "42", "1", "2"];

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitCtx.mockResolvedValue(mockCtx);
        mockGetMerkleRoot.mockReturnValue("100");
        mockGetActionState.mockReturnValue("200");
        mockGetActionListHash.mockReturnValue("0");
        mockMinaActionUpdateOne.mockResolvedValue({});
        mockBridgeStateUpdateOne.mockResolvedValue({});
    });

    it("throws when block not found in DB", async () => {
        mockMinaActionFindOne.mockResolvedValue(null);
        await expect(worker({ blockHeight: 50, actions: [] })).rejects.toThrow("not found");
    });

    it("returns early without sending TX when block is already done", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "done", failCount: 0 });
        await worker({ blockHeight: 50, actions: [] });
        expect(mockSendReduceTx).not.toHaveBeenCalled();
    });

    it("returns early without sending TX when failCount >= MAX_FAIL_COUNT", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "submitted", failCount: 3 });
        await worker({ blockHeight: 50, actions: [] });
        expect(mockSendReduceTx).not.toHaveBeenCalled();
    });

    it("calls sendReduceTx and marks block done on success", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });

        await worker({ blockHeight: 50, actions: [rawAction] });

        expect(mockSendReduceTx).toHaveBeenCalledOnce();
        expect(mockMinaActionUpdateOne).toHaveBeenCalledWith(
            { blockHeight: 50 },
            { $set: { status: "done" } },
        );
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledWith(
            {},
            { $set: { lastSubmittedHeight: 50 } },
        );
    });

    it("passes ctx, batch, mask, and proofs to sendReduceTx", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });

        await worker({ blockHeight: 50, actions: [rawAction] });

        const call = mockSendReduceTx.mock.calls[0][0];
        expect(call.ctx).toBe(mockCtx);
        expect(call.batch).toBeDefined();
        expect(call.mask).toBeDefined();
        expect(call.validateReduceProof).toBeDefined();
        expect(call.actionStackProof).toBeDefined();
    });

    it("calls requestSignatures with the on-chain initial action state", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 0 });
        mockGetActionState.mockReturnValue("12345");

        await worker({ blockHeight: 50, actions: [rawAction] });

        expect(mockRequestSignatures).toHaveBeenCalledWith("12345", expect.any(String));
    });

    it("worker with failCount below MAX_FAIL_COUNT still processes", async () => {
        mockMinaActionFindOne.mockResolvedValue({ status: "pending", failCount: 2 });

        await worker({ blockHeight: 50, actions: [rawAction] });

        expect(mockSendReduceTx).toHaveBeenCalledOnce();
    });
});
