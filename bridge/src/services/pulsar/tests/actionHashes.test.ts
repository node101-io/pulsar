import { describe, it, expect, vi, afterEach } from "vitest";

// The env module is mocked so tests control the REST base; logger resolves
// the same mocked module and only needs NODE_ENV.
const { envMock } = vi.hoisted(() => ({
    envMock: {
        NODE_ENV: "test",
        PULSAR_GRPC_ENDPOINT: "grpc.test:9090",
    },
}));
vi.mock("../../../config/env.js", () => ({ env: envMock }));

// The real contracts fold is Poseidon — faked with cheap arithmetic so the
// oracle below can replay roots. The module folds ONE leaf per step
// (foldApprovalCursor, the same primitive the reduce circuit runs); the list
// helper is the oracle's convenience. Accepts Fields or decimal strings and
// emits decimal strings, reduced mod the Pallas modulus like the real fold,
// so a long chain of pushes still produces roots the decoders accept.
const { fakeFoldStep, fakeFoldList } = vi.hoisted(() => {
    const MODULUS =
        28948022309329048855892746252171976963363056481941560715954676764349967630337n;
    const step = (
        root: { toString(): string },
        leaf: { toString(): string },
    ): string =>
        (
            (BigInt(root.toString()) * 1_000_003n + BigInt(leaf.toString())) %
            MODULUS
        ).toString();
    const list = (hashes: string[], root: string): string =>
        hashes.reduce<string>((r, leaf) => step(r, leaf), root);
    return { fakeFoldStep: step, fakeFoldList: list };
});
vi.mock("pulsar-contracts/build/src/utils/pulsarActionLeaf.js", () => ({
    foldApprovalCursor: vi.fn(fakeFoldStep),
}));

// The gRPC transport is pulsar-chain-client's; these tests drive the module
// through mocked fetch helpers so the oracle stays a pure function of
// (query, pinned height).
const { mockFetchLatestActionHashes, mockFetchActionsReducedRoot } =
    vi.hoisted(() => ({
        mockFetchLatestActionHashes: vi.fn(),
        mockFetchActionsReducedRoot: vi.fn(),
    }));
vi.mock("pulsar-chain-client", () => ({
    BridgeQueryClient: class {},
    fetchLatestActionHashes: mockFetchLatestActionHashes,
    fetchActionsReducedRoot: mockFetchActionsReducedRoot,
    grpcCredentials: () => ({}),
}));

import { foldApprovalCursor } from "pulsar-contracts/build/src/utils/pulsarActionLeaf.js";
import {
    ApprovalHistoryPrunedError,
    ApprovalIntegrityError,
    ApprovalWireSpecError,
    collectApprovalLeaves,
    decodeFieldElement,
    fetchActionsReducedRoot,
    fetchActionsBatch,
    resetVerifiedBatchCache,
} from "../actionHashes.js";

// Symbolic query names — the oracle predates the gRPC move and keys on them.
const PATHS = {
    actionHashes: "LatestActionHashes",
    reducedRoot: "ActionsReducedRoot",
};

type Oracle = (path: string, heightHeader: string | undefined) => unknown;

function stubFetch(oracle: Oracle) {
    mockFetchLatestActionHashes.mockImplementation(
        async (_client: unknown, atCosmosHeight?: number) =>
            oracle(
                PATHS.actionHashes,
                atCosmosHeight === undefined
                    ? undefined
                    : String(atCosmosHeight),
            ),
    );
    mockFetchActionsReducedRoot.mockImplementation(
        async (_client: unknown, atCosmosHeight?: number) =>
            oracle(
                PATHS.reducedRoot,
                atCosmosHeight === undefined
                    ? undefined
                    : String(atCosmosHeight),
            ),
    );
}

// A ServiceError-shaped rejection: what @grpc/grpc-js hands the callback.
function stubStatus(code: number) {
    const error = Object.assign(new Error(`grpc status ${code}`), { code });
    mockFetchLatestActionHashes.mockRejectedValue(error);
    mockFetchActionsReducedRoot.mockRejectedValue(error);
}

interface Push {
    /** Cosmos block that produced the batch. */
    height: number;
    /** Exclusive lower / inclusive upper Mina cursors: (start, cursor]. */
    start: bigint;
    cursor: bigint;
    hashes: string[];
}

/**
 * Models the chain's bridge state as seen through height-pinned reads: the
 * batch visible at cosmos height h is the newest push at or before h, and the
 * root at h is the fold of every push up to h. A chain that has not pushed yet
 * reports the initial state, whose cosmos height is 0.
 */
function chainOracle(
    latestHeight: number,
    pushes: Push[],
    genesisCursor = 0n,
): Oracle {
    const rootAt = (h: number) =>
        pushes
            .filter((p) => p.height <= h)
            .reduce((root, p) => fakeFoldList(p.hashes, root), "0");
    const batchAt = (h: number) => {
        const past = pushes.filter((p) => p.height <= h);
        const last = past[past.length - 1];
        return {
            start_mina_height: (last?.start ?? genesisCursor).toString(),
            latest_fetched_mina_height: (last?.cursor ?? genesisCursor).toString(),
            action_hashes: last?.hashes ?? [],
            action_hashes_cosmos_block_height: (last?.height ?? 0).toString(),
        };
    };
    return (path, heightHeader) => {
        // Cosmos reads an explicit height 0 as LATEST, not as genesis —
        // mirror that, or the oracle blesses an h-1 read at cosmos height 1.
        const h =
            heightHeader === undefined || heightHeader === "0"
                ? latestHeight
                : Number(heightHeader);
        switch (path) {
            case PATHS.actionHashes:
                return batchAt(h);
            case PATHS.reducedRoot:
                return { actions_reduced_root: rootAt(h) };
            default:
                throw new Error(`unexpected path ${path}`);
        }
    };
}

afterEach(() => {
    mockFetchLatestActionHashes.mockReset();
    mockFetchActionsReducedRoot.mockReset();
    vi.mocked(foldApprovalCursor).mockClear();
    resetVerifiedBatchCache();
});

describe("decodeFieldElement", () => {
    it("accepts a decimal field element", () => {
        expect(decodeFieldElement("123", "leaf")).toBe("123");
    });

    it("canonicalises a zero-padded value so cursor comparisons stay exact", () => {
        expect(decodeFieldElement("0000123", "leaf")).toBe("123");
        expect(decodeFieldElement("0", "leaf")).toBe("0");
    });

    it("rejects anything that is not a decimal string", () => {
        // 32 base64 bytes: the encoding the root used before the chain moved
        // it to decimal, and no longer a shape this decoder guesses at.
        const base64 = Buffer.alloc(32, 7).toString("base64");
        expect(() => decodeFieldElement(base64, "root")).toThrow(
            ApprovalWireSpecError,
        );
        expect(() => decodeFieldElement(42, "root")).toThrow(
            ApprovalWireSpecError,
        );
    });

    it("rejects a value at or above the Pallas modulus", () => {
        const modulus =
            "28948022309329048855892746252171976963363056481941560715954676764349967630337";
        expect(() => decodeFieldElement(modulus, "leaf")).toThrow(
            /Pallas field modulus/,
        );
        expect(
            decodeFieldElement((BigInt(modulus) - 1n).toString(), "leaf"),
        ).toBe((BigInt(modulus) - 1n).toString());
    });
});

describe("fetchActionsBatch", () => {
    // The chain team's observed response, verbatim, from the
    // return-string-action-root branch. If this test needs editing, the wire
    // spec at the top of actionHashes.ts must move with it.
    const OBSERVED_BODY = {
        start_mina_height: "46",
        latest_fetched_mina_height: "56",
        action_hashes: [
            "15716941071233514932119286727423960401313156380415428224723275206029618763673",
        ],
        action_hashes_cosmos_block_height: "1200",
    };

    it("parses the chain's observed response", async () => {
        stubFetch(() => OBSERVED_BODY);
        await expect(fetchActionsBatch()).resolves.toEqual({
            startMinaHeight: 46n,
            latestFetchedMinaHeight: 56n,
            cosmosBlockHeight: 1200n,
            actionHashes: OBSERVED_BODY.action_hashes,
        });
    });

    it("passes the historical height header when pinned", async () => {
        const seen: (string | undefined)[] = [];
        stubFetch((_path, height) => {
            seen.push(height);
            return OBSERVED_BODY;
        });
        await fetchActionsBatch(900);
        expect(seen).toEqual(["900"]);
    });

    it("rejects a missing height field rather than defaulting it", async () => {
        stubFetch(() => ({
            ...OBSERVED_BODY,
            action_hashes_cosmos_block_height: undefined,
        }));
        await expect(fetchActionsBatch()).rejects.toThrow(
            ApprovalWireSpecError,
        );
    });

    it("rejects a non-array hash list rather than folding zero leaves", async () => {
        stubFetch(() => ({ ...OBSERVED_BODY, action_hashes: "nope" }));
        await expect(fetchActionsBatch()).rejects.toThrow(
            /action_hashes is not an array/,
        );
    });
});

describe("fetchActionsReducedRoot", () => {
    it("reads the decimal root the chain now serves", async () => {
        stubFetch(() => ({ actions_reduced_root: "0000404" }));
        await expect(fetchActionsReducedRoot()).resolves.toBe("404");
    });

    it("rejects a missing root", async () => {
        stubFetch(() => ({}));
        await expect(fetchActionsReducedRoot()).rejects.toThrow(
            ApprovalWireSpecError,
        );
    });
});

describe("collectApprovalLeaves", () => {
    it("returns [] when the cursor IS the chain's current root", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 900, start: 40n, cursor: 60n, hashes: ["7", "9"] },
            ]),
        );
        const tipRoot = fakeFoldList(["7", "9"], "0");
        await expect(collectApprovalLeaves(tipRoot)).resolves.toEqual([]);
    });

    it("returns the whole verified history from a virgin cursor, oldest push first", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 800, start: 10n, cursor: 30n, hashes: ["3", "4"] },
                { height: 900, start: 30n, cursor: 60n, hashes: ["7"] },
            ]),
        );
        const root800 = fakeFoldList(["3", "4"], "0");
        const root900 = fakeFoldList(["7"], root800);
        await expect(collectApprovalLeaves("0")).resolves.toEqual([
            { cosmosBlockHeight: 800, leaves: ["3", "4"], rootAfter: root800 },
            { cosmosBlockHeight: 900, leaves: ["7"], rootAfter: root900 },
        ]);
    });

    it("anchors at a push boundary: only leaves past the cursor are returned", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 800, start: 10n, cursor: 30n, hashes: ["3", "4"] },
                { height: 900, start: 30n, cursor: 60n, hashes: ["7"] },
            ]),
        );
        const root800 = fakeFoldList(["3", "4"], "0");
        const root900 = fakeFoldList(["7"], root800);
        await expect(collectApprovalLeaves(root800)).resolves.toEqual([
            { cosmosBlockHeight: 900, leaves: ["7"], rootAfter: root900 },
        ]);
    });

    it("anchors MID-push: the covering push is trimmed to the leaves past the cursor", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 800, start: 10n, cursor: 30n, hashes: ["3", "4", "5"] },
                { height: 900, start: 30n, cursor: 60n, hashes: ["7"] },
            ]),
        );
        // A reduce may cut a batch anywhere, so the contract's cursor can sit
        // after any leaf — here after "3", one leaf into the push at 800.
        const cursor = fakeFoldList(["3"], "0");
        const root800 = fakeFoldList(["3", "4", "5"], "0");
        const root900 = fakeFoldList(["7"], root800);
        await expect(collectApprovalLeaves(cursor)).resolves.toEqual([
            { cosmosBlockHeight: 800, leaves: ["4", "5"], rootAfter: root800 },
            { cosmosBlockHeight: 900, leaves: ["7"], rootAfter: root900 },
        ]);
    });

    it("returns [] for a virgin cursor against a chain that has never pushed", async () => {
        stubFetch(chainOracle(1000, []));
        await expect(collectApprovalLeaves("0")).resolves.toEqual([]);
    });

    it("throws ApprovalHistoryPrunedError for a non-empty cursor against a chain that never pushed", async () => {
        stubFetch(chainOracle(1000, []));
        await expect(collectApprovalLeaves("123456")).rejects.toThrow(
            ApprovalHistoryPrunedError,
        );
    });

    it("walks back one block per push instead of searching heights", async () => {
        const fetchSpy = vi.fn();
        const pushes: Push[] = [
            { height: 700, start: 10n, cursor: 30n, hashes: ["3"] },
            { height: 800, start: 30n, cursor: 45n, hashes: ["5"] },
            { height: 900, start: 45n, cursor: 60n, hashes: ["7"] },
        ];
        stubFetch(
            ((oracle) => (path: string, height: string | undefined) => {
                fetchSpy(path, height);
                return oracle(path, height);
            })(chainOracle(1000, pushes)),
        );
        // Cursor at the boundary after the push at 700: the walk must verify
        // 900 and 800, find the cursor as 800's pre-root, and never touch 700.
        const root700 = fakeFoldList(["3"], "0");
        const result = await collectApprovalLeaves(root700);
        expect(result.map((slice) => slice.cosmosBlockHeight)).toEqual([
            800, 900,
        ]);
        expect(result.flatMap((slice) => slice.leaves)).toEqual(["5", "7"]);
        const pinnedBatchReads = fetchSpy.mock.calls
            .filter(([path]) => path === PATHS.actionHashes)
            .map(([, height]) => height);
        expect(pinnedBatchReads).toEqual([undefined, "899"]);
    });

    it("throws ApprovalIntegrityError when a batch does not fold to the root", async () => {
        const oracle = chainOracle(1000, [
            { height: 900, start: 40n, cursor: 60n, hashes: ["7"] },
        ]);
        stubFetch((path, height) => {
            const body = oracle(path, height) as Record<string, unknown>;
            if (path === PATHS.actionHashes)
                return { ...body, action_hashes: ["8"] };
            return body;
        });
        await expect(collectApprovalLeaves("0")).rejects.toThrow(
            ApprovalIntegrityError,
        );
    });

    it("throws ApprovalIntegrityError when consecutive batches do not meet", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 800, start: 10n, cursor: 30n, hashes: ["5"] },
                { height: 900, start: 45n, cursor: 60n, hashes: ["7"] },
            ]),
        );
        await expect(collectApprovalLeaves("0")).rejects.toThrow(
            /batches do not meet/,
        );
    });

    it("throws ApprovalHistoryPrunedError when the walk reaches the initial state without passing the cursor", async () => {
        // The chain's history folds to roots the cursor is not among — a
        // restarted chain or a divergence; either way not a prefix.
        stubFetch(
            chainOracle(
                1000,
                [{ height: 900, start: 40n, cursor: 60n, hashes: ["7"] }],
                40n,
            ),
        );
        await expect(collectApprovalLeaves("123456")).rejects.toThrow(
            ApprovalHistoryPrunedError,
        );
    });

    it("blames the unreadable genesis pre-state at cosmos height 1", async () => {
        // A push at height 1 whose root does not fold from the empty root is
        // a zero-height restart, not corrupt data.
        stubFetch((path, heightHeader) => {
            if (path === PATHS.actionHashes)
                return {
                    start_mina_height: "40",
                    latest_fetched_mina_height: "60",
                    action_hashes: ["7"],
                    action_hashes_cosmos_block_height: "1",
                };
            return {
                actions_reduced_root:
                    heightHeader === "1" ? "999999" : "123456",
            };
        });
        await expect(collectApprovalLeaves("55")).rejects.toThrow(
            ApprovalHistoryPrunedError,
        );
    });

    it("reuses a verified push instead of refolding it", async () => {
        stubFetch(
            chainOracle(1000, [
                { height: 900, start: 40n, cursor: 60n, hashes: ["7", "9"] },
            ]),
        );
        await collectApprovalLeaves("0");
        await collectApprovalLeaves("0");
        // One fold call per leaf, once — the second walk hits the cache.
        expect(foldApprovalCursor).toHaveBeenCalledTimes(2);
    });

    it("does not cache a push that failed verification", async () => {
        let corrupt = true;
        const oracle = chainOracle(1000, [
            { height: 900, start: 40n, cursor: 60n, hashes: ["7"] },
        ]);
        stubFetch((path, height) => {
            const body = oracle(path, height) as Record<string, unknown>;
            if (path === PATHS.actionHashes && corrupt)
                return { ...body, action_hashes: ["8"] };
            return body;
        });
        await expect(collectApprovalLeaves("0")).rejects.toThrow(
            ApprovalIntegrityError,
        );
        corrupt = false;
        await expect(collectApprovalLeaves("0")).resolves.toEqual([
            {
                cosmosBlockHeight: 900,
                leaves: ["7"],
                rootAfter: fakeFoldList(["7"], "0"),
            },
        ]);
    });
});

describe("gRPC fault taxonomy", () => {
    it("treats an unimplemented query as a wire-spec violation", async () => {
        stubStatus(12); // UNIMPLEMENTED — the node predates the query set
        await expect(fetchActionsBatch()).rejects.toThrow(
            ApprovalWireSpecError,
        );
    });

    it("treats a refused height-pinned read as unreachable history", async () => {
        for (const code of [5, 3]) {
            // NOT_FOUND (keeper: pruned snapshot) and INVALID_ARGUMENT
            // (baseapp: pruned state version)
            stubStatus(code);
            await expect(fetchActionsBatch(900)).rejects.toThrow(
                ApprovalHistoryPrunedError,
            );
        }
    });

    it("leaves a node that is down or shedding load transient", async () => {
        for (const code of [14, 4, 8, 13]) {
            // UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, INTERNAL
            stubStatus(code);
            const error = await fetchActionsBatch().catch((e) => e);
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(ApprovalWireSpecError);
            expect(error).not.toBeInstanceOf(ApprovalHistoryPrunedError);
        }
    });

    it("keeps a codeless failure transient rather than striking", async () => {
        mockFetchLatestActionHashes.mockRejectedValue(
            new Error("socket hang up"),
        );
        const error = await fetchActionsBatch().catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(ApprovalWireSpecError);
        expect(error).not.toBeInstanceOf(ApprovalHistoryPrunedError);
    });
});
