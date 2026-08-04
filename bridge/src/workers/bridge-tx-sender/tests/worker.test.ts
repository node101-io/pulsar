import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bool, Field } from "o1js";

// paths relative to src/workers/bridge-tx-sender/tests/
// bridge-internal:  ../../../X     (3 up = src/)
// worker itself:    ../worker.js   (1 up)
// contracts:        pulsar-contracts/build/src/X

// ---------------------------------------------------------------------------
// Mock boundaries
//
// We keep the *pure* contract helpers real (PulsarAction, constants,
// SignaturePublicKeyList types) so buildSignatureList / the included-actions
// map exercise the same o1js code paths the contract uses.
//
// We mock the *heavy / IO* boundaries: the archive fetch, batch+stack-proof
// preparation (PrepareBatchWithActions), ZK proof generation, the Mina tx
// sender, the validator signature request, the Mina client and the DB models.
// ---------------------------------------------------------------------------

const {
    mockBridgeStateUpdateOne,
    mockInitCtx,
    mockRefreshContractState,
    mockGetMerkleRoot,
    mockGetActionState,
    mockGetSettledHeight,
    mockGetActionStateHistory,
    mockFetchActions,
    mockPrepareBatchWithActions,
    mockCalculateFinalActionState,
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
    mockPrepareBatchWithActions: vi.fn(),
    mockCalculateFinalActionState: vi.fn(),
    mockRequestSignatures: vi.fn(),
    mockResolveValidatorSetForRoot: vi.fn(),
    mockGenerateValidateReduceProof: vi.fn(),
    mockProveReduceTx: vi.fn(),
    mockSendProvedReduceTx: vi.fn(),
}));

vi.mock("pulsar-contracts/build/src/utils/fetch.js", () => ({
    fetchActions: mockFetchActions,
    waitForTransaction: vi.fn(),
}));

vi.mock("pulsar-contracts/build/src/utils/reduceWitness.js", () => ({
    PrepareBatchWithActions: mockPrepareBatchWithActions,
}));

vi.mock("pulsar-contracts/build/src/utils/actionQueueUtils.js", () => ({
    CalculateFinalActionState: mockCalculateFinalActionState,
}));

vi.mock("pulsar-contracts/build/src/utils/generateFunctions.js", () => ({
    GenerateValidateReduceProof: mockGenerateValidateReduceProof,
}));

// Keep BATCH_SIZE / VALIDATOR_NUMBER real, just pass through.
vi.mock("pulsar-contracts/build/src/utils/constants.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("pulsar-contracts/build/src/utils/constants.js")>();
    return { ...actual };
});

// ensureCompiled is never called in unit tests; the program handles are only
// dereferenced inside it.
vi.mock("pulsar-contracts/build/src/ActionStack.js", () => ({
    ActionStackProgram: { compile: vi.fn() },
}));

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

// Mock the gRPC-backed validator-set resolution (IO boundary); the pure
// buildSignatureList join stays real below.
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

import {
    worker,
    buildSignatureList,
    assertPossibleQuorum,
    TransientReduceError,
} from "../worker.js";

import {
    PulsarAction,
    PulsarAuth,
    CosmosSignature,
} from "pulsar-contracts/build/src/types/PulsarAction.js";
import { VALIDATOR_NUMBER } from "pulsar-contracts/build/src/utils/constants.js";
import { PrivateKey, PublicKey, Signature } from "o1js";

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

function makePacked(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        action: makeDepositAction(),
        hash: BigInt(1000 + i),
    }));
}

// Distinct, deterministic, valid curve points — PublicKey.fromBase58 in
// buildSignatureList rejects non-group elements.
function makeValidatorKey(i: number) {
    return PrivateKey.fromBigInt(BigInt(i + 1)).toPublicKey();
}

function makeValidatorSet(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        minaPublicKey: makeValidatorKey(i).toBase58(),
        power: "1",
    }));
}

function makeValidatorSigs(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        validatorPublicKey: makeValidatorKey(i),
        signature: Signature.empty(),
    }));
}

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("buildSignatureList", () => {
    it("builds a list of length VALIDATOR_NUMBER with powers from the set", () => {
        const list = buildSignatureList(
            makeValidatorSet(VALIDATOR_NUMBER),
            makeValidatorSigs(VALIDATOR_NUMBER),
        );
        expect(list.list).toHaveLength(VALIDATOR_NUMBER);
        for (const item of list.list) {
            expect(item.power.toString()).toBe("1");
        }
    });

    it("ignores signatures from keys outside the validator set", () => {
        const list = buildSignatureList(
            makeValidatorSet(VALIDATOR_NUMBER),
            makeValidatorSigs(VALIDATOR_NUMBER + 2),
        );
        expect(list.list).toHaveLength(VALIDATOR_NUMBER);
    });

    it("keeps non-signing validators' keys + power with a dummy signature", () => {
        const set = makeValidatorSet(VALIDATOR_NUMBER);
        const list = buildSignatureList(
            set,
            makeValidatorSigs(VALIDATOR_NUMBER - 1), // last validator didn't sign
        );
        const last = list.list[VALIDATOR_NUMBER - 1];
        expect(last.publicKey.toBase58()).toBe(
            set[VALIDATOR_NUMBER - 1].minaPublicKey,
        );
        expect(last.power.toString()).toBe("1");
        // DUMMY_SIGNATURE (r=1, s=1) — fails verify, excluded from quorum
        expect(last.signature.toBase58()).toBe(
            Signature.fromValue({ r: 1n, s: 1n }).toBase58(),
        );
    });

    it("throws when the validator set size != VALIDATOR_NUMBER", () => {
        expect(() =>
            buildSignatureList(
                makeValidatorSet(VALIDATOR_NUMBER - 1),
                makeValidatorSigs(VALIDATOR_NUMBER),
            ),
        ).toThrow(/VALIDATOR_NUMBER/);
    });
});

describe("assertPossibleQuorum", () => {
    it("passes when every validator signed", () => {
        expect(() =>
            assertPossibleQuorum(
                makeValidatorSet(VALIDATOR_NUMBER),
                makeValidatorSigs(VALIDATOR_NUMBER),
            ),
        ).not.toThrow();
    });

    it("throws when signed power is below 2/3 even if all sigs are valid", () => {
        // one fewer signer than the 2/3 threshold (uniform power = 1)
        const belowQuorum = Math.ceil((VALIDATOR_NUMBER * 2) / 3) - 1;
        expect(() =>
            assertPossibleQuorum(
                makeValidatorSet(VALIDATOR_NUMBER),
                makeValidatorSigs(belowQuorum),
            ),
        ).toThrow(/quorum/);
    });

    it("weighs by power, not by count", () => {
        // 1 signer holding 10 power vs 2 non-signers with 1 each: 10/12 >= 2/3
        const set = makeValidatorSet(3).map((v, i) => ({
            ...v,
            power: i === 0 ? "10" : "1",
        }));
        expect(() =>
            assertPossibleQuorum(set, makeValidatorSigs(1)),
        ).not.toThrow();
    });
});

// ===========================================================================
// worker() — one reduce over the front of the on-chain pending queue
// ===========================================================================

const PROCESSED = "100"; // contract state[0] — the processed pointer
const TIP = "999"; // account actionState[0] — the live queue tip

describe("worker()", () => {
    const mockCtx = {
        contractAddress: PublicKey.empty(),
        contract: { __mock: "contract" },
        network: "devnet",
        nodeEndpoint: "https://node",
        archiveEndpoint: "https://archive",
        zkappState: [],
        actionStateHistory: [],
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInitCtx.mockResolvedValue(mockCtx);
        mockRefreshContractState.mockResolvedValue(undefined);
        mockGetActionState.mockReturnValue(PROCESSED);
        mockGetActionStateHistory.mockReturnValue([TIP, "888", "777", "666", "555"]);
        mockGetMerkleRoot.mockReturnValue("4242");
        mockGetSettledHeight.mockReturnValue(33);
        mockFetchActions.mockResolvedValue(makePacked(2));
        // the refolded queue ends exactly at the live tip
        mockCalculateFinalActionState.mockReturnValue(Field(TIP));
        mockPrepareBatchWithActions.mockResolvedValue({
            batchActions: [makeDepositAction()],
            batch: { __mock: "batch" },
            useActionStack: Bool(false),
            actionStackProof: { __mock: "stack-proof" },
            publicInput: { __mock: "public-input" },
            mask: { __mock: "mask" },
            endActionState: Field(TIP),
        });
        mockBridgeStateUpdateOne.mockResolvedValue({});
        mockRequestSignatures.mockResolvedValue(makeValidatorSigs(VALIDATOR_NUMBER));
        mockResolveValidatorSetForRoot.mockResolvedValue(
            makeValidatorSet(VALIDATOR_NUMBER),
        );
        mockGenerateValidateReduceProof.mockResolvedValue({ __mock: "reduce-proof" });
        mockProveReduceTx.mockResolvedValue('{"provedTx":true}');
        mockSendProvedReduceTx.mockResolvedValue(undefined);
    });

    it("returns without fetching or proving when the front equals the live tip", async () => {
        mockGetActionState.mockReturnValue(TIP); // fully reduced

        await worker({ fromActionState: TIP });

        expect(mockFetchActions).not.toHaveBeenCalled();
        expect(mockPrepareBatchWithActions).not.toHaveBeenCalled();
        expect(mockProveReduceTx).not.toHaveBeenCalled();
    });

    it("throws a TRANSIENT error when the archive returns nothing on a gap — no strike", async () => {
        mockFetchActions.mockResolvedValue([]);

        await expect(
            worker({ fromActionState: PROCESSED }),
        ).rejects.toBeInstanceOf(TransientReduceError);
        expect(mockPrepareBatchWithActions).not.toHaveBeenCalled();
    });

    it("wraps an archive fetch failure as TRANSIENT — no strike", async () => {
        mockFetchActions.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(
            worker({ fromActionState: PROCESSED }),
        ).rejects.toBeInstanceOf(TransientReduceError);
        expect(mockPrepareBatchWithActions).not.toHaveBeenCalled();
    });

    it("throws a NON-transient error when the refolded queue matches no stored action state", async () => {
        mockCalculateFinalActionState.mockReturnValue(Field(123456)); // matches nothing

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection.message).toMatch(/unverifiable reconstruction/);
        // deterministic bad archive data MUST charge the front's budget
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        // ...and the identity was already stamped, so the strike lands on the
        // right front
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledTimes(1);
        // initial refresh + one retry refresh before giving up
        expect(mockRefreshContractState).toHaveBeenCalledTimes(2);
        expect(mockPrepareBatchWithActions).not.toHaveBeenCalled();
        expect(mockRequestSignatures).not.toHaveBeenCalled();
    });

    it("accepts a fold that matches an OLDER stored action state (race tolerance)", async () => {
        // actions dispatched during our snapshot moved the tip; our fold lands
        // on history[1] — still provable thanks to the 5-slot window
        mockCalculateFinalActionState.mockReturnValue(Field(888));

        await worker({ fromActionState: PROCESSED });

        expect(mockProveReduceTx).toHaveBeenCalledOnce();
        // signatures must follow the REFOLDED tip (what the stack proof ends
        // at), never the account's live tip
        expect(mockRequestSignatures).toHaveBeenCalledWith(PROCESSED, "888");
    });

    it("fetches the queue from the contract's processed pointer", async () => {
        await worker({ fromActionState: PROCESSED });

        const [address, from] = mockFetchActions.mock.calls[0];
        expect(address).toBe(mockCtx.contractAddress);
        expect(from.toString()).toBe(PROCESSED);
    });

    it("prepares the batch via PrepareBatchWithActions with an approve-all included map", async () => {
        const packed = makePacked(2);
        mockFetchActions.mockResolvedValue(packed);

        await worker({ fromActionState: PROCESSED });

        const [included, contract, passedPacked] =
            mockPrepareBatchWithActions.mock.calls[0];
        expect(contract).toBe(mockCtx.contract);
        expect(passedPacked).toBe(packed);
        // placeholder until validators provide the real approval set: every
        // pending action's hash is in the map
        for (const pack of packed) {
            expect(
                included.get(pack.action.unconstrainedHash().toString()),
            ).toBeGreaterThan(0);
        }
    });

    it("requests signatures over (processed pointer, refolded tip)", async () => {
        await worker({ fromActionState: PROCESSED });

        expect(mockRequestSignatures).toHaveBeenCalledWith(PROCESSED, TIP);
    });

    it("stamps the identity before fetching, flags in-flight before proving, clears after the send", async () => {
        await worker({ fromActionState: PROCESSED });

        // 1st write = identity stamp (preserve-or-reset), BEFORE fetchActions
        // so even pre-proving strikes land on the right front
        const identityCall = mockBridgeStateUpdateOne.mock.calls[0];
        expect(identityCall[1]).toEqual([
            {
                $set: {
                    txFailCount: {
                        $cond: [
                            { $eq: ["$txAttemptActionState", { $literal: PROCESSED }] },
                            { $ifNull: ["$txFailCount", 0] },
                            0,
                        ],
                    },
                    txAttemptActionState: { $literal: PROCESSED },
                },
            },
        ]);
        expect(identityCall[2]).toEqual({ upsert: true });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder[0],
        ).toBeLessThan(mockFetchActions.mock.invocationCallOrder[0]);

        // 2nd write = in-flight flag, before the expensive batch preparation
        expect(mockBridgeStateUpdateOne.mock.calls[1][1]).toEqual({
            $set: { txAttemptActive: true },
        });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder[1],
        ).toBeLessThan(mockPrepareBatchWithActions.mock.invocationCallOrder[0]);

        // last write clears the in-flight flag, after the send completed
        const lastCall = mockBridgeStateUpdateOne.mock.calls.at(-1);
        expect(lastCall![1]).toEqual({ $set: { txAttemptActive: false } });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder.at(-1)!,
        ).toBeGreaterThan(mockSendProvedReduceTx.mock.invocationCallOrder[0]);
    });

    it("passes the prepared batch, mask and proofs through to proveReduceTx and sends", async () => {
        await worker({ fromActionState: PROCESSED });

        const call = mockProveReduceTx.mock.calls[0][0];
        expect(call.ctx).toBe(mockCtx);
        expect(call.batch).toEqual({ __mock: "batch" });
        expect(call.mask).toEqual({ __mock: "mask" });
        expect(call.actionStackProof).toEqual({ __mock: "stack-proof" });
        expect(call.validateReduceProof).toEqual({ __mock: "reduce-proof" });
        expect(call.fromActionState).toBe(PROCESSED);
        expect(mockSendProvedReduceTx).toHaveBeenCalledWith(
            mockCtx,
            '{"provedTx":true}',
            PROCESSED,
        );
    });

    it("generates the validate-reduce proof from PrepareBatch's publicInput", async () => {
        await worker({ fromActionState: PROCESSED });

        const [publicInput] = mockGenerateValidateReduceProof.mock.calls[0];
        expect(publicInput).toEqual({ __mock: "public-input" });
    });

    it("propagates a proving failure WITHOUT clearing the in-flight flag", async () => {
        mockProveReduceTx.mockRejectedValue(new Error("prove failed"));

        await expect(worker({ fromActionState: PROCESSED })).rejects.toThrow(
            "prove failed",
        );

        // identity stamp + in-flight flag only; txAttemptActive stays true so
        // a crash before onJobFailed still gets booked at startup
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledTimes(2);
        expect(mockBridgeStateUpdateOne.mock.calls.at(-1)![1]).toEqual({
            $set: { txAttemptActive: true },
        });
    });
});
