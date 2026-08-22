import { describe, it, expect, vi, beforeEach } from "vitest";

// What activeNodeEndpoint currently reports. Mutable so a test can simulate a
// failover moving the daemon under a context that was built earlier.
let activeEndpoint: string | null = null;

vi.mock("o1js", () => ({
    PublicKey: { fromBase58: vi.fn() },
}));

vi.mock("pulsar-contracts", () => ({
    fetchBlockHeight: vi.fn(),
    setMinaNetwork: vi.fn(),
    // The walk and the error mapping live in pulsar-contracts and are pinned
    // by contracts/src/test/fetch.test.ts. What matters here is that the
    // client routes every account read through fetchCheckedAccount at all.
    fetchCheckedAccount: vi.fn(),
    activeNodeEndpoint: vi.fn((network: string) => activeEndpoint ?? network),
    SettlementContract: vi.fn().mockImplementation(function (this: any) {
        this.blockHeight = {
            get: vi.fn().mockReturnValue({ toString: () => "800" }),
        };
    }),
    ENDPOINTS: {
        NODE: {
            devnet: "https://devnet.example.com",
            mainnet: "https://mainnet.example.com",
            lightnet: "http://localhost:8080",
        },
    },
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import {
    fetchBlockHeight,
    fetchCheckedAccount,
    setMinaNetwork,
    SettlementContract,
    ENDPOINTS,
} from "pulsar-contracts";
import {
    initMinaClientContext,
    getCurrentMinaBlockHeight,
    getContractBlockHeight,
} from "../client.js";

const mockAddress = { toBase58: () => "B62qtest" } as any;

/** What fetchCheckedAccount resolves to for a readable account. */
const readableAccount = { publicKey: mockAddress } as any;

describe("mina client", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeEndpoint = ENDPOINTS.NODE.devnet;
    });

    describe("initMinaClientContext", () => {
        it("sets network, fetches account, creates contract and returns context", async () => {
            vi.mocked(fetchCheckedAccount).mockResolvedValue(readableAccount);

            const ctx = await initMinaClientContext(mockAddress, "devnet");

            expect(setMinaNetwork).toHaveBeenCalledWith("devnet");
            expect(fetchCheckedAccount).toHaveBeenCalledWith(
                mockAddress,
                "Contract account fetch",
            );
            expect(SettlementContract).toHaveBeenCalledWith(mockAddress);
            expect(ctx.network).toBe("devnet");
            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.devnet);
            expect(ctx.watchedAddress).toBe(mockAddress);
        });

        it("returns correct endpoint for lightnet", async () => {
            vi.mocked(fetchCheckedAccount).mockResolvedValue(readableAccount);
            activeEndpoint = ENDPOINTS.NODE.lightnet;

            const ctx = await initMinaClientContext(mockAddress, "lightnet");

            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.lightnet);
        });

        it("throws when the node cannot read the account", async () => {
            // The BOOTSTRAP misread (a dead node's null answer passing init
            // silently, until 2026-08-22) is now caught inside
            // fetchCheckedAccount — pinned in contracts/src/test/fetch.test.ts.
            // Here: the client must propagate it, not swallow it.
            vi.mocked(fetchCheckedAccount).mockRejectedValue(
                new Error("Could not fetch account B62qtest: BOOTSTRAP"),
            );

            await expect(
                initMinaClientContext(mockAddress, "devnet"),
            ).rejects.toThrow(/Could not fetch account B62qtest: BOOTSTRAP/);
        });

        it("follows a later failover instead of pinning the startup endpoint", async () => {
            vi.mocked(fetchCheckedAccount).mockResolvedValue(readableAccount);

            const ctx = await initMinaClientContext(mockAddress, "devnet");
            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.devnet);

            // A failover moves the daemon after the context was built; the
            // stall-recovery poll in the settler master reads ctx.endpoint
            // long after this point and must not keep polling the dead one.
            activeEndpoint = "https://fallback.example.com";

            expect(ctx.endpoint).toBe("https://fallback.example.com");
        });
    });

    describe("getCurrentMinaBlockHeight", () => {
        it("delegates to fetchBlockHeight and returns result", async () => {
            vi.mocked(fetchBlockHeight).mockResolvedValue(1234);

            const result = await getCurrentMinaBlockHeight("lightnet");

            expect(fetchBlockHeight).toHaveBeenCalledWith("lightnet");
            expect(result).toBe(1234);
        });
    });

    describe("getContractBlockHeight", () => {
        it("fetches account and returns blockHeight as number", async () => {
            vi.mocked(fetchCheckedAccount).mockResolvedValue(readableAccount);

            const mockContract = {
                blockHeight: {
                    get: vi.fn().mockReturnValue({ toString: () => "800" }),
                },
            };
            const ctx = {
                watchedAddress: mockAddress,
                settlementContract: mockContract as any,
                network: "devnet" as const,
                endpoint: "https://devnet.example.com",
            };

            const result = await getContractBlockHeight(ctx);

            expect(fetchCheckedAccount).toHaveBeenCalledWith(
                mockAddress,
                "Contract account fetch",
            );
            expect(result).toBe(800);
        });
    });
});
