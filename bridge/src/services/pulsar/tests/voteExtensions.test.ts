import { describe, it, expect, vi, beforeEach } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        NODE_ENV: "test",
        PULSAR_GRPC_ENDPOINT: "localhost:9090",
    },
}));
vi.mock("../../../config/env.js", () => ({ env: envMock }));

// The gRPC fetch layer is pulsar-chain-client's; these tests pin only this
// module's SELECTION logic (pinned-first, latest-fallback, usability gates).
const { mockFetchSignedVoteExtension, mockGetLatestHeight } = vi.hoisted(
    () => ({
        mockFetchSignedVoteExtension: vi.fn(),
        mockGetLatestHeight: vi.fn(),
    }),
);
vi.mock("pulsar-chain-client", () => ({
    AbciQueryClient: class {},
    TendermintClient: class {},
    VotePersistenceClient: class {},
    VOTE_EXT_PERSISTENCE_LAG: 3,
    fetchSignedVoteExtension: mockFetchSignedVoteExtension,
    getLatestHeight: mockGetLatestHeight,
    grpcCredentials: () => ({}),
}));

import { findSignedRootAtOrBeyond } from "../voteExtensions.js";

const VS_ROOT = "4242";

function record(cosmosHeight: number, overrides: Record<string, unknown> = {}) {
    const { signatures = [{ minaPublicKey: "B62qTest", r: "1", s: "2" }], ...body } =
        overrides as { signatures?: unknown } & Record<string, string>;
    return {
        cosmosHeight,
        body: {
            nextValidatorSetHash: VS_ROOT,
            stateRootHi: "11",
            stateRootLo: "22",
            currentBlockHeight: String(cosmosHeight),
            actionsReducedRoot: "7040",
            ...body,
        },
        signatures,
    };
}

beforeEach(() => {
    mockFetchSignedVoteExtension.mockReset();
    mockGetLatestHeight.mockReset();
    envMock.PULSAR_GRPC_ENDPOINT = "localhost:9090";
});

describe("findSignedRootAtOrBeyond", () => {
    it("returns the pinned covering-height record without touching the tip", async () => {
        mockFetchSignedVoteExtension.mockResolvedValueOnce(record(40));
        const found = await findSignedRootAtOrBeyond(40, VS_ROOT);
        expect(found?.cosmosHeight).toBe(40);
        expect(mockGetLatestHeight).not.toHaveBeenCalled();
    });

    it("falls back to the latest signed root when the pinned window was missed", async () => {
        mockFetchSignedVoteExtension
            .mockResolvedValueOnce(record(40, { signatures: [] }))
            .mockResolvedValueOnce(record(97));
        mockGetLatestHeight.mockResolvedValue(100);
        const found = await findSignedRootAtOrBeyond(40, VS_ROOT);
        expect(found?.cosmosHeight).toBe(97);
        // tip 100 - LAG 3 = 97: the newest height whose signatures are
        // already persisted.
        expect(mockFetchSignedVoteExtension).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.anything(),
            97,
        );
    });

    it("falls back when the pinned read throws (pruned version)", async () => {
        mockFetchSignedVoteExtension
            .mockRejectedValueOnce(new Error("NotFound"))
            .mockResolvedValueOnce(record(97));
        mockGetLatestHeight.mockResolvedValue(100);
        const found = await findSignedRootAtOrBeyond(40, VS_ROOT);
        expect(found?.cosmosHeight).toBe(97);
    });

    it("rejects a pinned record signed under another validator-set root", async () => {
        mockFetchSignedVoteExtension
            .mockResolvedValueOnce(record(40, { nextValidatorSetHash: "9" }))
            .mockResolvedValueOnce(record(97));
        mockGetLatestHeight.mockResolvedValue(100);
        const found = await findSignedRootAtOrBeyond(40, VS_ROOT);
        expect(found?.cosmosHeight).toBe(97);
    });

    it("returns null while the covering push is too fresh for persistence", async () => {
        // Covering height 99; tip 100 → newest readable is 97 < 99: the only
        // possible source was the pinned read, and it missed.
        mockFetchSignedVoteExtension.mockResolvedValueOnce(
            record(99, { signatures: [] }),
        );
        mockGetLatestHeight.mockResolvedValue(100);
        const found = await findSignedRootAtOrBeyond(99, VS_ROOT);
        expect(found).toBeNull();
        expect(mockFetchSignedVoteExtension).toHaveBeenCalledTimes(1);
    });

    it("returns null when both reads are unusable", async () => {
        mockFetchSignedVoteExtension
            .mockResolvedValueOnce(record(40, { signatures: [] }))
            .mockResolvedValueOnce(record(97, { signatures: [] }));
        mockGetLatestHeight.mockResolvedValue(100);
        await expect(findSignedRootAtOrBeyond(40, VS_ROOT)).resolves.toBeNull();
    });

});
