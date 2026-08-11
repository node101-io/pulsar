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
// SignaturePublicKeyList, VoteExtBody) so buildSignatureList and the quorum
// body construction exercise the same o1js code paths the circuits use.
//
// We mock the *heavy / IO* boundaries: the archive fetch, the approval walk,
// the signed-root archive read, the witness construction (BuildVerdictBatch),
// ZK proof generation, the Mina tx sender, the Mina client and the DB models.
// ---------------------------------------------------------------------------

const {
    mockBridgeStateUpdateOne,
    mockInitCtx,
    mockRefreshContractState,
    mockGetMerkleRoot,
    mockGetActionState,
    mockGetApprovalCursor,
    mockGetSettledHeight,
    mockGetActionStateHistory,
    mockFetchActions,
    mockCollectApprovalLeaves,
    mockBuildVerdictBatch,
    mockCalculateFinalActionState,
    mockFindSignedRoot,
    mockResolveValidatorSetForRoot,
    mockGenerateActionStackProof,
    mockGenerateApprovalTailProof,
    mockGenerateApprovalQuorumProof,
    mockProveReduceTx,
    mockSendProvedReduceTx,
    envMock,
} = vi.hoisted(() => ({
    mockBridgeStateUpdateOne: vi.fn(),
    mockInitCtx: vi.fn(),
    mockRefreshContractState: vi.fn(),
    mockGetMerkleRoot: vi.fn(),
    mockGetActionState: vi.fn(),
    mockGetApprovalCursor: vi.fn(),
    mockGetSettledHeight: vi.fn(),
    mockGetActionStateHistory: vi.fn(),
    mockFetchActions: vi.fn(),
    mockCollectApprovalLeaves: vi.fn(),
    mockBuildVerdictBatch: vi.fn(),
    mockCalculateFinalActionState: vi.fn(),
    mockFindSignedRoot: vi.fn(),
    mockResolveValidatorSetForRoot: vi.fn(),
    mockGenerateActionStackProof: vi.fn(),
    mockGenerateApprovalTailProof: vi.fn(),
    mockGenerateApprovalQuorumProof: vi.fn(),
    mockProveReduceTx: vi.fn(),
    mockSendProvedReduceTx: vi.fn(),
    // MAX_RETRY feeds config/constants.js, which resolves the mocked env
    // module too.
    envMock: {
        NODE_ENV: "test",
        MAX_RETRY: 3,
        PULSAR_GRPC_ENDPOINT: "grpc.test:9090",
    },
}));

vi.mock("../../../config/env.js", () => ({ env: envMock }));

vi.mock("pulsar-contracts/build/src/utils/fetch.js", () => ({
    fetchActions: mockFetchActions,
    waitForTransaction: vi.fn(),
}));

vi.mock("pulsar-contracts/build/src/utils/reduceWitness.js", () => ({
    BuildVerdictBatch: mockBuildVerdictBatch,
}));

vi.mock("pulsar-contracts/build/src/utils/actionQueueUtils.js", () => ({
    CalculateFinalActionState: mockCalculateFinalActionState,
}));

vi.mock("pulsar-contracts/build/src/utils/generateFunctions.js", () => ({
    GenerateActionStackProof: mockGenerateActionStackProof,
    GenerateApprovalTailProof: mockGenerateApprovalTailProof,
    GenerateApprovalQuorumProof: mockGenerateApprovalQuorumProof,
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
vi.mock("pulsar-contracts/build/src/ApprovalTail.js", () => ({
    ApprovalTailProgram: { compile: vi.fn() },
}));
vi.mock("pulsar-contracts/build/src/ApprovalQuorum.js", () => ({
    ApprovalQuorumProgram: { compile: vi.fn() },
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
    getContractApprovalCursor: mockGetApprovalCursor,
    getContractSettledHeight: mockGetSettledHeight,
    getActionStateHistory: mockGetActionStateHistory,
}));

// The approval walk is an IO boundary. The error classes must be the SAME
// objects the worker instanceof-checks (and throws itself), so the factory
// defines them and the test imports them back from the mocked module.
vi.mock("../../../services/pulsar/actionHashes.js", () => ({
    collectApprovalLeaves: mockCollectApprovalLeaves,
    ApprovalIntegrityError: class ApprovalIntegrityError extends Error {},
    ApprovalWireSpecError: class ApprovalWireSpecError extends Error {},
    ApprovalHistoryPrunedError: class ApprovalHistoryPrunedError extends Error {},
}));

// The on-demand signed-root read (gRPC via pulsar-chain-client).
vi.mock("../../../services/pulsar/voteExtensions.js", () => ({
    findSignedRootAtOrBeyond: mockFindSignedRoot,
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
    type ValidatorSignature,
} from "../worker.js";

import {
    ApprovalHistoryPrunedError,
    ApprovalIntegrityError,
    ApprovalWireSpecError,
} from "../../../services/pulsar/actionHashes.js";
import {
    PulsarAction,
    PulsarAuth,
    CosmosSignature,
} from "pulsar-contracts/build/src/types/PulsarAction.js";
import { VALIDATOR_NUMBER } from "pulsar-contracts/build/src/utils/constants.js";
import { PrivateKey, PublicKey, Signature } from "o1js";

// --- helpers ---

function makeDepositAction(amount = 1_000_000_000n) {
    return PulsarAction.deposit(
        PublicKey.empty(),
        Field(amount),
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

function makeValidatorSigs(n: number): ValidatorSignature[] {
    return Array.from({ length: n }, (_, i) => ({
        validatorPublicKey: makeValidatorKey(i),
        signature: Signature.empty(),
    }));
}

// Vote-extension signature rows, the shape pulsar-chain-client returns.
function makeSignedRootSigs(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        minaPublicKey: makeValidatorKey(i).toBase58(),
        r: "12",
        s: "34",
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
const CURSOR = "5000"; // contract state[4] — the approval cursor
const END_CURSOR = "6000"; // cursor after folding the batch
const MERKLE = "4242"; // contract state[1] — validator-set root
const LEAF_A = "1001";
const LEAF_B = "1002";
const ROOT_40 = "7040"; // chain root after the push at cosmos height 40

function makeSignedRoot(overrides: Record<string, unknown> = {}) {
    const {
        cosmosHeight = 41,
        signatures = makeSignedRootSigs(VALIDATOR_NUMBER),
        ...bodyOverrides
    } = overrides as {
        cosmosHeight?: number;
        signatures?: unknown;
    } & Record<string, string>;
    return {
        cosmosHeight,
        body: {
            nextValidatorSetHash: MERKLE,
            stateRootHi: "11",
            stateRootLo: "22",
            currentBlockHeight: String(cosmosHeight),
            actionsReducedRoot: ROOT_40,
            ...bodyOverrides,
        },
        signatures,
    };
}

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
        mockGetMerkleRoot.mockReturnValue(MERKLE);
        mockGetSettledHeight.mockReturnValue(33);
        mockGetApprovalCursor.mockReturnValue(CURSOR);
        mockFetchActions.mockResolvedValue(makePacked(2));
        // the refolded queue ends exactly at the live tip
        mockCalculateFinalActionState.mockReturnValue(Field(TIP));
        // one push whose two leaves cover the whole pending queue
        mockCollectApprovalLeaves.mockResolvedValue([
            { cosmosBlockHeight: 40, leaves: [LEAF_A, LEAF_B], rootAfter: ROOT_40 },
        ]);
        // consume both queue positions; leave no tail
        mockBuildVerdictBatch.mockImplementation(
            (packed: { action: PulsarAction }[]) => ({
                batch: { __mock: "batch" },
                verdicts: { __mock: "verdicts" },
                batchActions: packed.slice(0, 2).map((pack) => pack.action),
                endCursor: Field(END_CURSOR),
                tailLeaves: [],
            }),
        );
        mockFindSignedRoot.mockResolvedValue(makeSignedRoot());
        mockResolveValidatorSetForRoot.mockResolvedValue(
            makeValidatorSet(VALIDATOR_NUMBER),
        );
        mockGenerateActionStackProof.mockResolvedValue({
            useActionStack: Bool(false),
            actionStackProof: { __mock: "stack-proof" },
        });
        mockGenerateApprovalTailProof.mockResolvedValue({ __mock: "tail-proof" });
        mockGenerateApprovalQuorumProof.mockResolvedValue({ __mock: "quorum-proof" });
        mockProveReduceTx.mockResolvedValue('{"provedTx":true}');
        mockSendProvedReduceTx.mockResolvedValue(undefined);
        mockBridgeStateUpdateOne.mockResolvedValue({});
    });

    it("returns without fetching or proving when the front equals the live tip", async () => {
        mockGetActionState.mockReturnValue(TIP); // fully reduced

        await worker({ fromActionState: TIP });

        expect(mockFetchActions).not.toHaveBeenCalled();
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
        expect(mockProveReduceTx).not.toHaveBeenCalled();
    });

    it("throws a TRANSIENT error when the archive returns nothing on a gap — no strike", async () => {
        mockFetchActions.mockResolvedValue([]);

        await expect(
            worker({ fromActionState: PROCESSED }),
        ).rejects.toBeInstanceOf(TransientReduceError);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("wraps an archive fetch failure as TRANSIENT — no strike", async () => {
        mockFetchActions.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(
            worker({ fromActionState: PROCESSED }),
        ).rejects.toBeInstanceOf(TransientReduceError);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
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
        expect(mockCollectApprovalLeaves).not.toHaveBeenCalled();
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("accepts a fold that matches an OLDER stored action state (race tolerance)", async () => {
        // actions dispatched during our snapshot moved the tip; our fold lands
        // on history[1] — still provable thanks to the 5-slot window
        mockCalculateFinalActionState.mockReturnValue(Field(888));

        await worker({ fromActionState: PROCESSED });

        expect(mockProveReduceTx).toHaveBeenCalledOnce();
    });

    it("fetches the queue from the contract's processed pointer", async () => {
        await worker({ fromActionState: PROCESSED });

        const [address, from] = mockFetchActions.mock.calls[0];
        expect(address).toBe(mockCtx.contractAddress);
        expect(from.toString()).toBe(PROCESSED);
    });

    it("walks the chain's leaf list from the contract's approvalCursor", async () => {
        await worker({ fromActionState: PROCESSED });

        expect(mockCollectApprovalLeaves).toHaveBeenCalledWith(CURSOR);
    });

    it("passes the queue, the flattened leaves and the cursor to BuildVerdictBatch", async () => {
        const packed = makePacked(2);
        mockFetchActions.mockResolvedValue(packed);

        await worker({ fromActionState: PROCESSED });

        const [passedPacked, leaves, fromCursor] =
            mockBuildVerdictBatch.mock.calls[0];
        expect(passedPacked).toBe(packed);
        expect(leaves.map((leaf: Field) => leaf.toString())).toEqual([
            LEAF_A,
            LEAF_B,
        ]);
        expect(fromCursor.toString()).toBe(CURSOR);
    });

    it("throws TRANSIENT while the chain has not adjudicated past the cursor", async () => {
        mockCollectApprovalLeaves.mockResolvedValue([]);

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(TransientReduceError);
        expect(rejection.message).toMatch(/not adjudicated past/);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
        // The walk runs BEFORE the in-flight flag: waiting on the chain must
        // not leave a flag that startup books as an interrupted expensive
        // attempt. Only the identity stamp ran.
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledTimes(1);
    });

    it("propagates ApprovalIntegrityError NON-transient — it must strike the breaker", async () => {
        mockCollectApprovalLeaves.mockRejectedValue(
            new ApprovalIntegrityError("fold mismatch"),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(ApprovalIntegrityError);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("propagates ApprovalWireSpecError NON-transient — a deterministic decode fault must strike", async () => {
        mockCollectApprovalLeaves.mockRejectedValue(
            new ApprovalWireSpecError("leaf hash is hex"),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(ApprovalWireSpecError);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("propagates ApprovalHistoryPrunedError NON-transient — an unreachable cursor must strike", async () => {
        mockCollectApprovalLeaves.mockRejectedValue(
            new ApprovalHistoryPrunedError("cursor predates the window"),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(ApprovalHistoryPrunedError);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("wraps other walk failures as TRANSIENT, keeping the original as cause", async () => {
        const cause = new Error("fetch failed");
        mockCollectApprovalLeaves.mockRejectedValue(cause);

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(TransientReduceError);
        // undici's "fetch failed" says nothing on its own — the frame and
        // the real reason survive only on the cause chain.
        expect(rejection.cause).toBe(cause);
        expect(mockBuildVerdictBatch).not.toHaveBeenCalled();
    });

    it("propagates a BuildVerdictBatch divergence throw NON-transient", async () => {
        // A chain leaf matching neither verdict is a chain/L1 divergence —
        // deterministic, needs a governance rebase, must strike.
        mockBuildVerdictBatch.mockImplementation(() => {
            throw new Error(
                "chain leaf at position 0 matches neither verdict",
            );
        });

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection.message).toMatch(/neither verdict/);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        expect(mockFindSignedRoot).not.toHaveBeenCalled();
    });

    it("targets the oldest signed root at or beyond the push covering the batch end", async () => {
        // The batch consumes 2 leaves; the second one was appended by the
        // push at cosmos height 44, so the covering height is 44 — a root
        // signed before it could not commit to the whole batch.
        mockCollectApprovalLeaves.mockResolvedValue([
            { cosmosBlockHeight: 40, leaves: [LEAF_A], rootAfter: "7010" },
            { cosmosBlockHeight: 44, leaves: [LEAF_B], rootAfter: ROOT_40 },
        ]);
        mockFindSignedRoot.mockResolvedValue(
            makeSignedRoot({ cosmosHeight: 45 }),
        );

        await worker({ fromActionState: PROCESSED });

        // ...and filtered by the contract's validator-set root: any other
        // set's signature can never satisfy the circuit.
        expect(mockFindSignedRoot).toHaveBeenCalledWith(44, MERKLE);
    });

    it("throws TRANSIENT while no readable signed root covers the batch end", async () => {
        mockFindSignedRoot.mockResolvedValue(null);

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(TransientReduceError);
        expect(rejection.message).toMatch(/No readable signed root/);
        expect(mockGenerateApprovalTailProof).not.toHaveBeenCalled();
        // still before the in-flight flag — only the identity stamp ran
        expect(mockBridgeStateUpdateOne).toHaveBeenCalledTimes(1);
    });

    it("folds the tail only up to the signed root's state height", async () => {
        // 4 leaves across 3 pushes; the batch consumes 2, the signed root
        // (height 45) commits to the pushes at 40 and 44 but NOT 50 — so the
        // tail is exactly the unconsumed leaf of the push at 44.
        mockCollectApprovalLeaves.mockResolvedValue([
            { cosmosBlockHeight: 40, leaves: [LEAF_A, LEAF_B], rootAfter: "7010" },
            { cosmosBlockHeight: 44, leaves: ["1003"], rootAfter: ROOT_40 },
            { cosmosBlockHeight: 50, leaves: ["1004"], rootAfter: "7050" },
        ]);
        mockFindSignedRoot.mockResolvedValue(
            makeSignedRoot({ cosmosHeight: 45 }),
        );

        await worker({ fromActionState: PROCESSED });

        const [anchor, tailLeaves] = mockGenerateApprovalTailProof.mock.calls[0];
        expect(anchor.toString()).toBe(END_CURSOR);
        expect(tailLeaves.map((leaf: Field) => leaf.toString())).toEqual([
            "1003",
        ]);
    });

    it("throws ApprovalIntegrityError when the archived root disagrees with the verified walk", async () => {
        // The signed root sits INSIDE the walked range (at the tip push's own
        // height) but commits to a root the verified fold never reaches — two
        // transports onto the same chain state disagree, deterministically.
        mockFindSignedRoot.mockResolvedValue(
            makeSignedRoot({ cosmosHeight: 40, actionsReducedRoot: "9999" }),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(ApprovalIntegrityError);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        expect(mockGenerateApprovalTailProof).not.toHaveBeenCalled();
    });

    it("treats a signed root NEWER than the walked range as TRANSIENT on mismatch", async () => {
        // A push landed between the REST walk and the Mongo read: the signed
        // root commits to leaves the walk has not seen. Re-walk, don't strike.
        mockFindSignedRoot.mockResolvedValue(
            makeSignedRoot({ cosmosHeight: 60, actionsReducedRoot: "9999" }),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection).toBeInstanceOf(TransientReduceError);
        expect(rejection.message).toMatch(/newer than the walked/);
    });

    it("throws up front when the archived signatures cannot reach quorum", async () => {
        mockFindSignedRoot.mockResolvedValue(
            makeSignedRoot({ signatures: makeSignedRootSigs(1) }),
        );

        const rejection = await worker({ fromActionState: PROCESSED }).then(
            () => {
                throw new Error("should have thrown");
            },
            (error) => error,
        );
        expect(rejection.message).toMatch(/quorum/);
        expect(rejection).not.toBeInstanceOf(TransientReduceError);
        // fail-fast: no proving started
        expect(mockGenerateActionStackProof).not.toHaveBeenCalled();
        expect(mockGenerateApprovalQuorumProof).not.toHaveBeenCalled();
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
        expect(identityCall[2]).toEqual({ upsert: true, updatePipeline: true });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder[0],
        ).toBeLessThan(mockFetchActions.mock.invocationCallOrder[0]);

        // 2nd write = in-flight flag, AFTER every transient-prone read (the
        // signed-root pick included) and BEFORE the expensive proving
        expect(mockBridgeStateUpdateOne.mock.calls[1][1]).toEqual({
            $set: { txAttemptActive: true },
        });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder[1],
        ).toBeGreaterThan(mockFindSignedRoot.mock.invocationCallOrder[0]);
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder[1],
        ).toBeLessThan(mockGenerateActionStackProof.mock.invocationCallOrder[0]);

        // last write clears the in-flight flag, after the send completed
        const lastCall = mockBridgeStateUpdateOne.mock.calls.at(-1);
        expect(lastCall![1]).toEqual({ $set: { txAttemptActive: false } });
        expect(
            mockBridgeStateUpdateOne.mock.invocationCallOrder.at(-1)!,
        ).toBeGreaterThan(mockSendProvedReduceTx.mock.invocationCallOrder[0]);
    });

    it("anchors the action stack at the batch-end state over the unbatched remainder", async () => {
        const packed = makePacked(3); // 2 consumed by the batch, 1 stacked
        mockFetchActions.mockResolvedValue(packed);

        await worker({ fromActionState: PROCESSED });

        // second refold = the batch-end anchor (the first is the tip check)
        const [anchorFrom, anchorActions] =
            mockCalculateFinalActionState.mock.calls[1];
        expect(anchorFrom.toString()).toBe(PROCESSED);
        expect(anchorActions).toEqual(
            packed.slice(0, 2).map((pack) => pack.action),
        );

        const [endActionState, stacked] =
            mockGenerateActionStackProof.mock.calls[0];
        expect(endActionState.toString()).toBe(TIP);
        expect(stacked).toEqual([packed[2].action]);
    });

    it("builds the quorum proof from the archived body, the full signature list and the tail proof", async () => {
        await worker({ fromActionState: PROCESSED });

        // the program folds the batch itself, so the generator receives the
        // batch, the verdicts and both fold start points
        const [batch, verdicts, fromActionState, cursorBefore, body, sigList, tailProof] =
            mockGenerateApprovalQuorumProof.mock.calls[0];
        expect(batch).toEqual({ __mock: "batch" });
        expect(verdicts).toEqual({ __mock: "verdicts" });
        expect(fromActionState.toString()).toBe(PROCESSED);
        expect(cursorBefore.toString()).toBe(CURSOR);
        // the body is rebuilt field-for-field from the archived signed root —
        // the circuit re-hashes it, so any drift fails signature verification
        expect(body.nextValidatorSetHash.toString()).toBe(MERKLE);
        expect(body.stateRootHi.toString()).toBe("11");
        expect(body.stateRootLo.toString()).toBe("22");
        expect(body.currentBlockHeight.toString()).toBe("41");
        expect(body.actionsReducedRoot.toString()).toBe(ROOT_40);
        // full slot list, archived signatures joined onto the ordered set
        expect(sigList.list).toHaveLength(VALIDATOR_NUMBER);
        expect(sigList.list[0].signature.toBase58()).toBe(
            Signature.fromValue({ r: 12n, s: 34n }).toBase58(),
        );
        expect(tailProof).toEqual({ __mock: "tail-proof" });
    });

    it("passes the batch, verdicts and both proofs through to proveReduceTx and sends", async () => {
        await worker({ fromActionState: PROCESSED });

        const call = mockProveReduceTx.mock.calls[0][0];
        expect(call.ctx).toBe(mockCtx);
        expect(call.batch).toEqual({ __mock: "batch" });
        expect(call.verdicts).toEqual({ __mock: "verdicts" });
        expect(call.actionStackProof).toEqual({ __mock: "stack-proof" });
        expect(call.approvalProof).toEqual({ __mock: "quorum-proof" });
        expect(call.fromActionState).toBe(PROCESSED);
        expect(mockSendProvedReduceTx).toHaveBeenCalledWith(
            mockCtx,
            '{"provedTx":true}',
            PROCESSED,
        );
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
