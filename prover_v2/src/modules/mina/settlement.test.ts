import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client.js", () => ({
    getContractBlockHeight: vi.fn(),
}));

vi.mock("o1js", () => ({
    fetchAccount: vi.fn().mockResolvedValue(undefined),
    Mina: {
        transaction: vi.fn(async (_opts: any, fn: () => Promise<void>) => {
            await fn();
            return {
                prove: vi.fn().mockResolvedValue(undefined),
                sign: vi.fn().mockReturnValue({
                    send: vi.fn().mockResolvedValue({ hash: "tx-hash-123" }),
                }),
            };
        }),
    },
    PrivateKey: {
        fromBase58: vi.fn(() => ({
            toPublicKey: vi.fn(() => "sender-pubkey"),
        })),
    },
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {},
    waitForTransaction: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

import { submitSettlement } from "./settlement.js";
import { getContractBlockHeight } from "./client.js";
import { waitForTransaction } from "pulsar-contracts";

const mockCtx = {
    watchedAddress: {} as any,
    settlementContract: { settle: vi.fn() } as any,
    network: "lightnet" as const,
    endpoint: "http://localhost:8080",
};
const mockProof = {} as any;

describe("mina settlement - submitSettlement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MINA_PRIVATE_KEY = "EKtest";
    });

    it("skips TX when contract is already past epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(100);

        await submitSettlement(mockCtx, mockProof, 80);

        expect(waitForTransaction).not.toHaveBeenCalled();
    });

    it("skips TX when contract is exactly at epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(80);

        await submitSettlement(mockCtx, mockProof, 80);

        expect(waitForTransaction).not.toHaveBeenCalled();
    });

    it("throws when MINA_PRIVATE_KEY is not set", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        delete process.env.MINA_PRIVATE_KEY;

        await expect(submitSettlement(mockCtx, mockProof, 80)).rejects.toThrow(
            "MINA_PRIVATE_KEY is not set",
        );
    });

    it("sends TX and returns on inclusion success", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(waitForTransaction).mockResolvedValue({
            success: true,
            failureReason: null,
        });

        await submitSettlement(mockCtx, mockProof, 80);

        expect(waitForTransaction).toHaveBeenCalledWith(
            "tx-hash-123",
            mockCtx.endpoint,
        );
        expect(waitForTransaction).toHaveBeenCalledTimes(1);
    });

    it("retries after TX rejection and succeeds on second attempt", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(waitForTransaction)
            .mockResolvedValueOnce({ success: false, failureReason: "rejected" })
            .mockResolvedValueOnce({ success: true, failureReason: null });

        await submitSettlement(mockCtx, mockProof, 80);

        expect(waitForTransaction).toHaveBeenCalledTimes(2);
    });

    it("throws after MAX_RETRY_COUNT consecutive rejections", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(waitForTransaction).mockResolvedValue({
            success: false,
            failureReason: "rejected",
        });

        await expect(submitSettlement(mockCtx, mockProof, 80)).rejects.toThrow(
            "Settlement failed after 3 attempts for block 80",
        );

        expect(waitForTransaction).toHaveBeenCalledTimes(3);
    });

    it("retries after TX send error and throws when all attempts fail", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        const { Mina } = await import("o1js");
        vi.mocked(Mina.transaction).mockRejectedValue(new Error("network error"));

        await expect(submitSettlement(mockCtx, mockProof, 80)).rejects.toThrow(
            "Settlement failed after 3 attempts for block 80",
        );

        expect(waitForTransaction).not.toHaveBeenCalled();
    });
});
