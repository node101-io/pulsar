import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("o1js", () => ({
    fetchAccount: vi.fn(),
    PublicKey: { fromBase58: vi.fn() },
}));

vi.mock("pulsar-contracts", () => ({
    fetchBlockHeight: vi.fn(),
    setMinaNetwork: vi.fn(),
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

vi.mock("../../logger.js", () => ({
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
} from "./client.js";

const mockAddress = { toBase58: () => "B62qtest" } as any;

describe("mina client", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("initMinaClientContext", () => {
        it("sets network, fetches account, creates contract and returns context", async () => {
            vi.mocked(fetchAccount).mockResolvedValue({} as any);

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
            vi.mocked(fetchAccount).mockResolvedValue({} as any);

            const ctx = await initMinaClientContext(mockAddress, "lightnet");

            expect(ctx.endpoint).toBe(ENDPOINTS.NODE.lightnet);
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
            vi.mocked(fetchAccount).mockResolvedValue({} as any);

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
