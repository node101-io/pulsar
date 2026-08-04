/**
 * Integration test for the Bridge TX Sender worker — REAL proof generation.
 *
 * Goal: verify the chain-derived reduce pipeline end-to-end *without* a Mina
 * node and *without* sending a transaction. We mock the IO boundaries (the
 * account/archive reads and the tx sender) but run the REAL
 * PrepareBatchWithActions → CalculateMax → GenerateActionStackProof path with
 * a compiled ActionStackProgram.
 *
 * This answers: "given a pending on-chain action queue, does the worker cut
 * the right batch, stack the full remainder, and anchor the stack proof the
 * way SettlementContract.reduce asserts it?" In particular it pins the
 * proveRecursive anchor semantics: the final stack proof's publicInput must
 * equal the batch-end action state even when the remainder spans multiple
 * ActionStackQueues.
 *
 * Heavy: compiles ActionStackProgram and runs real proveBase/proveRecursive.
 * Run with: npm run test:integration
 *
 * TODO(pulsar): GenerateValidateReduceProof + requestSignatures are mocked
 * because the validator signature flow is undefined until the Pulsar spec
 * lands. Once it does, wire in a real ValidateReduceProof here too.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Cache, Field } from "o1js";

const {
    mockBridgeStateUpdateOne,
    mockInitCtx,
    mockRefreshContractState,
    mockGetMerkleRoot,
    mockGetActionState,
    mockGetSettledHeight,
    mockGetActionStateHistory,
    mockFetchActions,
    mockRequestSignatures,
    mockResolveValidatorSetForRoot,
    mockGenerateValidateReduceProof,
    mockProveReduceTx,
    mockSendProvedReduceTx,
} = vi.hoisted(() => ({
    mockBridgeStateUpdateOne: vi.fn(),
    mockInitCtx: vi.fn(),
    mockRefreshContractState: vi.fn(),
    mockGetMerkleRoot: vi.fn(),
    mockGetActionState: vi.fn(),
    mockGetSettledHeight: vi.fn(),
    mockGetActionStateHistory: vi.fn(),
    mockFetchActions: vi.fn(),
    mockRequestSignatures: vi.fn(),
    mockResolveValidatorSetForRoot: vi.fn(),
    mockGenerateValidateReduceProof: vi.fn(),
    mockProveReduceTx: vi.fn(),
    mockSendProvedReduceTx: vi.fn(),
}));

// Archive boundary — the packed action lists are served by the test.
vi.mock("pulsar-contracts/build/src/utils/fetch.js", () => ({
    fetchActions: mockFetchActions,
    waitForTransaction: vi.fn(),
}));

// Keep PrepareBatchWithActions + GenerateActionStackProof REAL — only stub
// the pulsar-dependent GenerateValidateReduceProof.
vi.mock("pulsar-contracts/build/src/utils/generateFunctions.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("pulsar-contracts/build/src/utils/generateFunctions.js")>();
    return {
        ...actual,
        GenerateValidateReduceProof: mockGenerateValidateReduceProof,
    };
});

vi.mock("../../../common/logger.js", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../db/models/BridgeState.js", () => ({
    BridgeStateModel: { updateOne: mockBridgeStateUpdateOne },
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: mockInitCtx,
    refreshContractState: mockRefreshContractState,
    getContractMerkleRoot: mockGetMerkleRoot,
    getContractActionState: mockGetActionState,
    getContractSettledHeight: mockGetSettledHeight,
    getActionStateHistory: mockGetActionStateHistory,
}));

vi.mock("../../../services/pulsar/client.js", () => ({
    requestSignatures: mockRequestSignatures,
}));

// gRPC IO boundary — the real resolver needs a running chain node.
vi.mock("../../../services/pulsar/validatorSet.js", () => ({
    resolveValidatorSetForRoot: mockResolveValidatorSetForRoot,
}));

vi.mock("../../../services/mina/txSender.js", () => ({
    proveReduceTx: mockProveReduceTx,
    sendProvedReduceTx: mockSendProvedReduceTx,
}));

vi.mock("../../../config/constants.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../config/constants.js")>()),
}));

import { worker } from "../worker.js";
import { ActionStackProgram } from "pulsar-contracts/build/src/ActionStack.js";
import {
    PulsarAction,
    PulsarAuth,
    CosmosSignature,
} from "pulsar-contracts/build/src/types/PulsarAction.js";
import { CalculateFinalActionState } from "pulsar-contracts/build/src/utils/actionQueueUtils.js";
import {
    BATCH_SIZE,
    MAX_WITHDRAWAL_PER_BATCH,
    VALIDATOR_NUMBER,
} from "pulsar-contracts/build/src/utils/constants.js";
import { PrivateKey, PublicKey, Signature } from "o1js";

// --- helpers ---

function makeDepositAction(i: number) {
    return PulsarAction.deposit(
        PublicKey.empty(),
        Field(1_000_000_000n + BigInt(i)),
        new PulsarAuth({
            cosmosAddress: Field(42),
            cosmosSignature: new CosmosSignature({ r: Field(1), s: Field(2) }),
        }),
    );
}

function makeWithdrawAction(i: number) {
    return PulsarAction.withdrawal(PublicKey.empty(), Field(500_000_000n + BigInt(i)));
}

/** Rebuild the archive's view: each entry carries the action state AFTER it. */
function packActions(fromState: Field, actions: PulsarAction[]) {
    const packed: { action: PulsarAction; hash: bigint }[] = [];
    let state = fromState;
    for (const action of actions) {
        state = CalculateFinalActionState(state, [action]);
        packed.push({ action, hash: state.toBigInt() });
    }
    return packed;
}

function makeValidatorKey(i: number) {
    return PrivateKey.fromBigInt(BigInt(i + 1)).toPublicKey();
}

describe("Bridge TX Sender worker — real batch preparation and stack proofs", () => {
    const mockCtx = {
        contractAddress: PublicKey.empty(),
        // CalculateMax reads these two state fields off the contract instance
        contract: {
            merkleListRoot: { get: () => Field(4242) },
            actionListHash: { get: () => Field(0) },
        },
        network: "devnet",
        nodeEndpoint: "https://node",
        archiveEndpoint: "https://archive",
        zkappState: [],
        actionStateHistory: [],
    } as any;

    beforeAll(async () => {
        const t0 = Date.now();
        console.log("[integration] Compiling ActionStackProgram...");
        await ActionStackProgram.compile({ cache: Cache.FileSystemDefault });
        console.log(`[integration] ActionStackProgram compiled (${Date.now() - t0}ms)`);
    }, 600_000);

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitCtx.mockResolvedValue(mockCtx);
        mockRefreshContractState.mockResolvedValue(undefined);
        mockGetMerkleRoot.mockReturnValue("4242");
        mockGetSettledHeight.mockReturnValue(33);
        mockBridgeStateUpdateOne.mockResolvedValue({});
        mockRequestSignatures.mockResolvedValue(
            Array.from({ length: VALIDATOR_NUMBER }, (_, i) => ({
                validatorPublicKey: makeValidatorKey(i),
                signature: Signature.empty(),
            })),
        );
        mockResolveValidatorSetForRoot.mockResolvedValue(
            Array.from({ length: VALIDATOR_NUMBER }, (_, i) => ({
                minaPublicKey: makeValidatorKey(i).toBase58(),
                power: "1",
            })),
        );
        mockGenerateValidateReduceProof.mockResolvedValue({ __mock: "reduce-proof" });
        mockProveReduceTx.mockResolvedValue('{"provedTx":true}');
        mockSendProvedReduceTx.mockResolvedValue(undefined);
    });

    it("reduces a 130-action queue front-first across three jobs, anchoring every stack proof at the batch end", async () => {
        const initial = Field(0);
        const actions = Array.from({ length: 130 }, (_, i) => makeDepositAction(i));
        const packedAll = packActions(initial, actions);
        const tip = Field(packedAll[packedAll.length - 1].hash);

        // fold checkpoints the contract's state[0] will pass through
        const afterBatch1 = CalculateFinalActionState(initial, actions.slice(0, BATCH_SIZE));
        const afterBatch2 = CalculateFinalActionState(afterBatch1, actions.slice(BATCH_SIZE, 2 * BATCH_SIZE));

        mockGetActionStateHistory.mockReturnValue([tip.toString(), "1", "2", "3", "4"]);

        // ---- job 1: 130 pending -> batch 60, stack 70 (2 queues -> proveRecursive) ----
        mockGetActionState.mockReturnValue(initial.toString());
        mockFetchActions.mockResolvedValue(packedAll);

        await worker({ fromActionState: initial.toString() });

        let params = mockProveReduceTx.mock.calls[0][0];
        expect(params.useActionStack.toBoolean()).toBe(true);
        // the anchor: SettlementContract asserts publicInput == batch-end
        // action state — with 70 remaining (60+10 queues) this only holds if
        // proveRecursive re-exposes the ORIGINAL anchor
        expect(params.actionStackProof.publicInput.toString()).toBe(
            afterBatch1.toString(),
        );
        // and the stack must fold the full remainder to the live queue tip
        expect(params.actionStackProof.publicOutput.toString()).toBe(
            tip.toString(),
        );
        expect(mockRequestSignatures).toHaveBeenCalledWith(
            initial.toString(),
            tip.toString(),
        );

        // ---- job 2: 70 pending -> batch 60, stack 10 (single queue) ----
        mockGetActionState.mockReturnValue(afterBatch1.toString());
        mockFetchActions.mockResolvedValue(
            packActions(afterBatch1, actions.slice(BATCH_SIZE)),
        );

        await worker({ fromActionState: afterBatch1.toString() });

        params = mockProveReduceTx.mock.calls[1][0];
        expect(params.useActionStack.toBoolean()).toBe(true);
        expect(params.actionStackProof.publicInput.toString()).toBe(
            afterBatch2.toString(),
        );
        expect(params.actionStackProof.publicOutput.toString()).toBe(
            tip.toString(),
        );

        // ---- job 3: 10 pending -> batch 10, no stack ----
        mockGetActionState.mockReturnValue(afterBatch2.toString());
        mockFetchActions.mockResolvedValue(
            packActions(afterBatch2, actions.slice(2 * BATCH_SIZE)),
        );

        await worker({ fromActionState: afterBatch2.toString() });

        params = mockProveReduceTx.mock.calls[2][0];
        expect(params.useActionStack.toBoolean()).toBe(false);
        expect(params.batch.actions.slice(0, 10).every(
            (a: PulsarAction) => !PulsarAction.isDummy(a).toBoolean(),
        )).toBe(true);
        expect(mockSendProvedReduceTx).toHaveBeenCalledTimes(3);
    }, 1_800_000);

    it("caps withdrawals per batch and stacks the overflow instead of dropping it", async () => {
        const initial = Field(0);
        const withdrawals = Array.from(
            { length: MAX_WITHDRAWAL_PER_BATCH + 6 },
            (_, i) => makeWithdrawAction(i),
        );
        const packed = packActions(initial, withdrawals);
        const tip = Field(packed[packed.length - 1].hash);

        mockGetActionState.mockReturnValue(initial.toString());
        mockGetActionStateHistory.mockReturnValue([tip.toString(), "1", "2", "3", "4"]);
        mockFetchActions.mockResolvedValue(packed);

        await worker({ fromActionState: initial.toString() });

        const params = mockProveReduceTx.mock.calls[0][0];
        // batch stops at the withdrawal cap (the contract pays out each masked
        // withdrawal as an AccountUpdate — 9 is the per-tx budget)
        const realBatchActions = params.batch.actions.filter(
            (a: PulsarAction) => !PulsarAction.isDummy(a).toBoolean(),
        );
        expect(realBatchActions).toHaveLength(MAX_WITHDRAWAL_PER_BATCH);
        // the overflow is NOT dropped: it rides the stack and the proof still
        // reaches the live tip from the batch-end anchor
        expect(params.useActionStack.toBoolean()).toBe(true);
        const afterBatch = CalculateFinalActionState(
            initial,
            withdrawals.slice(0, MAX_WITHDRAWAL_PER_BATCH),
        );
        expect(params.actionStackProof.publicInput.toString()).toBe(
            afterBatch.toString(),
        );
        expect(params.actionStackProof.publicOutput.toString()).toBe(
            tip.toString(),
        );
    }, 1_800_000);
});
