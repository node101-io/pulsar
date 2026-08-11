import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
    getContractBlockHeight: vi.fn(),
}));

const mockTx = {
    prove: vi.fn().mockResolvedValue(undefined),
    toJSON: vi.fn().mockReturnValue('{"zkappCommand":{}}'),
    sign: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({ hash: "tx-hash-123" }),
    }),
    // sendProvedSettlement patches lazyAuthorization through this path
    transaction: { feePayer: {} as any },
};

vi.mock("o1js", () => ({
    fetchAccount: vi.fn().mockResolvedValue(undefined),
    Mina: {
        transaction: vi.fn(async (_opts: any, fn: () => Promise<void>) => {
            await fn();
            return mockTx;
        }),
        getAccount: vi.fn(() => ({ nonce: "5" })),
    },
    PrivateKey: {
        fromBase58: vi.fn(() => ({
            toPublicKey: vi.fn(() => "sender-pubkey"),
        })),
    },
    Transaction: {
        fromJSON: vi.fn(() => mockTx),
    },
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {},
    GenerateSettleAttestProof: vi.fn(async () => ({})),
    waitForTransaction: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

import { proveSettlementTx, sendProvedSettlement } from "../settlement.js";
import { getContractBlockHeight } from "../client.js";
import { waitForTransaction } from "pulsar-contracts";
import { Transaction } from "o1js";

const mockCtx = {
    watchedAddress: {} as any,
    settlementContract: { settle: vi.fn() } as any,
    network: "lightnet" as const,
    endpoint: "http://localhost:8080",
};
const mockProof = {} as any;
// sendProvedSettlement rewrites feePayer.body.nonce before re-signing
const PROVED_TX_JSON = '{"zkappCommand":{},"feePayer":{"body":{"nonce":"0"}}}';

describe("mina settlement - proveSettlementTx", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MINA_PRIVATE_KEY = "EKtest";
    });

    it("returns null when contract is already past epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(100);

        const result = await proveSettlementTx(mockCtx, mockProof, 80);

        expect(result).toBeNull();
        expect(mockTx.prove).not.toHaveBeenCalled();
    });

    it("returns null when contract is exactly at epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(80);

        const result = await proveSettlementTx(mockCtx, mockProof, 80);

        expect(result).toBeNull();
        expect(mockTx.prove).not.toHaveBeenCalled();
    });

    it("throws when MINA_PRIVATE_KEY is not set", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        delete process.env.MINA_PRIVATE_KEY;

        await expect(
            proveSettlementTx(mockCtx, mockProof, 80),
        ).rejects.toThrow("MINA_PRIVATE_KEY is not set");
    });

    it("proves tx and returns serialized JSON", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);

        const result = await proveSettlementTx(mockCtx, mockProof, 80);

        expect(mockTx.prove).toHaveBeenCalledTimes(1);
        expect(mockTx.toJSON).toHaveBeenCalledTimes(1);
        expect(result).toBe('{"zkappCommand":{}}');
    });
});

describe("mina settlement - sendProvedSettlement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MINA_PRIVATE_KEY = "EKtest";
    });

    it("skips send when contract is already past epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(100);

        await sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80);

        expect(waitForTransaction).not.toHaveBeenCalled();
    });

    it("skips send when contract is exactly at epochLastPulsarBlock", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(80);

        await sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80);

        expect(waitForTransaction).not.toHaveBeenCalled();
    });

    it("throws when MINA_PRIVATE_KEY is not set", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        delete process.env.MINA_PRIVATE_KEY;

        await expect(
            sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80),
        ).rejects.toThrow("MINA_PRIVATE_KEY is not set");
    });

    it("sends TX and returns on inclusion success", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(waitForTransaction).mockResolvedValue({
            success: true,
            failureReason: null,
        });

        await sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80);

        expect(Transaction.fromJSON).toHaveBeenCalledWith({
            zkappCommand: {},
            // nonce refreshed from the current on-chain account (mocked as "5")
            feePayer: { body: { nonce: "5" } },
        });
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

        await sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80);

        expect(waitForTransaction).toHaveBeenCalledTimes(2);
    });

    it("stops re-sending when the epoch settles during a retry", async () => {
        // First send's inclusion poll fails (e.g. transient endpoint error),
        // but the tx actually lands — the retry must detect the advanced
        // contract state and NOT send a duplicate.
        vi.mocked(getContractBlockHeight)
            .mockResolvedValueOnce(0) // entry check: not settled yet
            .mockResolvedValueOnce(80); // re-check on attempt 2: settled
        vi.mocked(waitForTransaction).mockResolvedValue({
            success: false,
            failureReason: "Max attempts reached",
        });

        await sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80);

        expect(waitForTransaction).toHaveBeenCalledTimes(1);
        expect(getContractBlockHeight).toHaveBeenCalledTimes(2);
    });

    it("throws after MAX_RETRY_COUNT consecutive rejections", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(waitForTransaction).mockResolvedValue({
            success: false,
            failureReason: "rejected",
        });

        await expect(
            sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80),
        ).rejects.toThrow("Settlement send failed after 3 attempts for block 80");

        expect(waitForTransaction).toHaveBeenCalledTimes(3);
    });

    it("retries after TX send error and throws when all attempts fail", async () => {
        vi.mocked(getContractBlockHeight).mockResolvedValue(0);
        vi.mocked(Transaction.fromJSON).mockImplementation(() => {
            throw new Error("network error");
        });

        await expect(
            sendProvedSettlement(mockCtx, PROVED_TX_JSON, 80),
        ).rejects.toThrow("Settlement send failed after 3 attempts for block 80");

        expect(waitForTransaction).not.toHaveBeenCalled();
    });
});
