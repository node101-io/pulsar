import { describe, it, expect, vi, beforeEach } from "vitest";

// What activeNodeEndpoint currently reports. Mutable so a test can simulate a
// failover moving the daemon under a context that was built earlier.
let activeEndpoint: string | null = null;

vi.mock("o1js", () => ({
    fetchAccount: vi.fn(),
    PublicKey: { fromBase58: vi.fn() },
}));

vi.mock("pulsar-contracts", () => ({
    fetchBlockHeight: vi.fn(),
    setMinaNetwork: vi.fn(),
    // Pass-through: the failover's own retry contract is covered by
    // contracts/src/test/fetch.test.ts. What matters here is that the client
    // routes its account reads through it at all.
    withNodeFailover: vi.fn(async (_what: string, run: () => Promise<any>) =>
        run(),
    ),
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

import { fetchAccount } from "o1js";
import {
    fetchBlockHeight,
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

/** fetchAccount's shape for an account the node could actually read. */
const readableAccount = { account: { publicKey: mockAddress } } as any;

describe("mina client", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeEndpoint = ENDPOINTS.NODE.devnet;
    });

    describe("initMinaClientContext", () => {
        it("sets network, fetches account, creates contract and returns context", async () => {
            vi.mocked(fetchAccount).mockResolvedValue(readableAccount);

            const ctx = await initMinaClientContext(mockAddress, "devnet");

            expect(setMinaNetwork).toHaveBeenCalledWith("devnet");
            expect(fetchAccount).toHaveBeenCalledWith({
                publicKey: mockAddress,
            });
            expect(SettlementContract).toHaveBeenCalledWith(mockAddress);
            expect(ctx.network).toBe("devnet");
            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.devnet);
            expect(ctx.watchedAddress).toBe(mockAddress);
        });

        it("returns correct endpoint for lightnet", async () => {
            vi.mocked(fetchAccount).mockResolvedValue(readableAccount);
            activeEndpoint = ENDPOINTS.NODE.lightnet;

            const ctx = await initMinaClientContext(mockAddress, "lightnet");

            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.lightnet);
        });

        it("throws when the node cannot read the account", async () => {
            // fetchAccount RESOLVES with an error rather than rejecting. Left
            // unchecked (as it was until 2026-08-22), a daemon in BOOTSTRAP —
            // which answers null for every address — passed init silently and
            // the contract only looked undeployed later, at blockHeight.get().
            vi.mocked(fetchAccount).mockResolvedValue({
                error: { statusText: "BOOTSTRAP" },
            } as any);

            await expect(
                initMinaClientContext(mockAddress, "devnet"),
            ).rejects.toThrow(/Could not fetch account B62qtest: BOOTSTRAP/);
        });

        it("follows a later failover instead of pinning the startup endpoint", async () => {
            vi.mocked(fetchAccount).mockResolvedValue(readableAccount);

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
            vi.mocked(fetchAccount).mockResolvedValue(readableAccount);

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

            expect(fetchAccount).toHaveBeenCalledWith({
                publicKey: mockAddress,
            });
            expect(result).toBe(800);
        });
    });
});
