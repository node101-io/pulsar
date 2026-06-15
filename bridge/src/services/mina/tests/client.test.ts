import { describe, it, expect, vi, beforeEach } from "vitest";

// paths relative to src/services/mina/tests/
// bridge-internal:  ../../../X     (3 up = src/)
// contracts:        ../../../../../contracts/build/src/X  (5 up = pulsar/)

vi.mock("o1js", () => ({
    fetchAccount: vi.fn(),
    PublicKey: {
        fromBase58: vi.fn((s: string) => ({ toBase58: () => s })),
    },
}));

vi.mock("../../../../../contracts/build/src/SettlementContract.js", () => ({
    SettlementContract: vi.fn().mockImplementation(() => ({
        merkleListRoot: { get: vi.fn().mockReturnValue({ toString: () => "111" }) },
        actionState: { get: vi.fn().mockReturnValue({ toString: () => "222" }) },
        actionListHash: { get: vi.fn().mockReturnValue({ toString: () => "333" }) },
    })),
}));

vi.mock("../../../../../contracts/build/src/utils/fetch.js", () => ({
    setMinaNetwork: vi.fn(),
    fetchBlockHeight: vi.fn().mockResolvedValue(500),
    waitForTransaction: vi.fn(),
}));

vi.mock("../../../../../contracts/build/src/utils/constants.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../../contracts/build/src/utils/constants.js")>();
    return { ...actual };
});

vi.mock("../../../common/logger.js", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CONTRACT_ADDR = "B62qTestContractAddress";

beforeEach(() => {
    vi.stubEnv("MINA_NETWORK", "devnet");
    vi.stubEnv("CONTRACT_ADDRESS", CONTRACT_ADDR);
});

const {
    fetchActionsByHeight,
    getContractMerkleRoot,
    getContractActionState,
    getContractActionListHash,
    getLatestMinaHeight,
} = await import("../client.js");

// --- fetchActionsByHeight ---

describe("fetchActionsByHeight", () => {
    function makeCtx() {
        return {
            contractAddress: { toBase58: () => CONTRACT_ADDR },
            archiveEndpoint: "https://archive.devnet",
        } as any;
    }

    it("returns empty array when archive returns no zkapps", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { zkapps: [] } }),
        }));

        const result = await fetchActionsByHeight(100, 200, makeCtx());
        expect(result).toEqual([]);
    });

    it("throws when archive returns HTTP error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

        await expect(fetchActionsByHeight(100, 200, makeCtx())).rejects.toThrow("HTTP 503");
    });

    it("throws when archive returns GraphQL errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ errors: [{ message: "field not found" }] }),
        }));

        await expect(fetchActionsByHeight(100, 200, makeCtx())).rejects.toThrow("field not found");
    });

    it("groups actions by blockHeight sorted ascending", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: {
                    zkapps: [
                        {
                            blockHeight: 150,
                            zkappCommand: {
                                accountUpdates: [{
                                    body: { publicKey: CONTRACT_ADDR, actions: [["1", "2", "3", "4", "5", "6", "7"]] },
                                }],
                            },
                        },
                        {
                            blockHeight: 120,
                            zkappCommand: {
                                accountUpdates: [{
                                    body: { publicKey: CONTRACT_ADDR, actions: [["1", "2", "3", "4", "5", "6", "7"]] },
                                }],
                            },
                        },
                    ],
                },
            }),
        }));

        const result = await fetchActionsByHeight(100, 200, makeCtx());
        expect(result).toHaveLength(2);
        expect(result[0].blockHeight).toBe(120);
        expect(result[1].blockHeight).toBe(150);
    });

    it("merges multiple account updates at the same height", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: {
                    zkapps: [{
                        blockHeight: 100,
                        zkappCommand: {
                            accountUpdates: [
                                { body: { publicKey: CONTRACT_ADDR, actions: [["1", "2", "3", "4", "5", "6", "7"]] } },
                                { body: { publicKey: CONTRACT_ADDR, actions: [["8", "9", "10", "11", "12", "13", "14"]] } },
                            ],
                        },
                    }],
                },
            }),
        }));

        const result = await fetchActionsByHeight(100, 100, makeCtx());
        expect(result).toHaveLength(1);
        expect(result[0].actions).toHaveLength(2);
    });

    it("ignores account updates for other addresses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: {
                    zkapps: [{
                        blockHeight: 100,
                        zkappCommand: {
                            accountUpdates: [{
                                body: { publicKey: "B62qSomeOtherAddress", actions: [["1", "2", "3", "4", "5", "6", "7"]] },
                            }],
                        },
                    }],
                },
            }),
        }));

        const result = await fetchActionsByHeight(100, 100, makeCtx());
        expect(result).toEqual([]);
    });

    it("ignores account updates with empty actions array", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: {
                    zkapps: [{
                        blockHeight: 100,
                        zkappCommand: {
                            accountUpdates: [{ body: { publicKey: CONTRACT_ADDR, actions: [] } }],
                        },
                    }],
                },
            }),
        }));

        const result = await fetchActionsByHeight(100, 100, makeCtx());
        expect(result).toEqual([]);
    });

    it("sends correct GraphQL query with height range and contract address", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: { zkapps: [] } }),
        });
        vi.stubGlobal("fetch", mockFetch);

        await fetchActionsByHeight(100, 200, makeCtx());

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe("https://archive.devnet");
        const body = JSON.parse(opts.body);
        expect(body.query).toContain("blockHeight_gte: 100");
        expect(body.query).toContain("blockHeight_lte: 200");
        expect(body.query).toContain(CONTRACT_ADDR);
    });
});

// --- getLatestMinaHeight ---

describe("getLatestMinaHeight", () => {
    it("delegates to fetchBlockHeight with network from ctx", async () => {
        const ctx = { network: "devnet" } as any;
        const result = await getLatestMinaHeight(ctx);
        expect(result).toBe(500);
    });
});

// --- contract state getters ---

describe("getContractMerkleRoot / ActionState / ActionListHash", () => {
    it("reads merkleListRoot from on-chain contract state", async () => {
        const ctx = {
            contractAddress: {},
            contract: { merkleListRoot: { get: () => ({ toString: () => "111" }) } },
        } as any;
        expect(await getContractMerkleRoot(ctx)).toBe("111");
    });

    it("reads actionState from on-chain contract state", async () => {
        const ctx = {
            contractAddress: {},
            contract: { actionState: { get: () => ({ toString: () => "222" }) } },
        } as any;
        expect(await getContractActionState(ctx)).toBe("222");
    });

    it("reads actionListHash from on-chain contract state", async () => {
        const ctx = {
            contractAddress: {},
            contract: { actionListHash: { get: () => ({ toString: () => "333" }) } },
        } as any;
        expect(await getContractActionListHash(ctx)).toBe("333");
    });
});
