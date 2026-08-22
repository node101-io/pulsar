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
    // Pass-through / canned account: the walk and the error mapping are
    // pinned in contracts/src/test/fetch.test.ts; here they only must not
    // swallow errors.
    withNodeFailover: vi.fn(async (_what: string, run: () => Promise<any>) =>
        run(),
    ),
    fetchCheckedAccount: vi.fn(async () => ({ nonce: "5" })),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

import {
    proveSettlementTx,
    broadcastProvedSettlement,
    fetchFeePayerLedgerNonce,
} from "../settlement.js";
import { getContractBlockHeight } from "../client.js";
import { Transaction } from "o1js";

const mockCtx = {
    watchedAddress: {} as any,
    settlementContract: { settle: vi.fn() } as any,
    network: "lightnet" as const,
    endpoint: "http://localhost:8080",
};
const mockProof = {} as any;
// broadcastProvedSettlement rewrites feePayer.body.nonce before re-signing
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

describe("mina settlement - broadcastProvedSettlement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MINA_PRIVATE_KEY = "EKtest";
    });

    it("throws when MINA_PRIVATE_KEY is not set", async () => {
        delete process.env.MINA_PRIVATE_KEY;

        await expect(
            broadcastProvedSettlement(PROVED_TX_JSON, 7, 80),
        ).rejects.toThrow("MINA_PRIVATE_KEY is not set");
    });

    it("signs with the given nonce and returns the tx hash", async () => {
        const hash = await broadcastProvedSettlement(PROVED_TX_JSON, 7, 80);

        expect(Transaction.fromJSON).toHaveBeenCalledWith({
            zkappCommand: {},
            // the PIPELINE's nonce, not the ledger's — sends run ahead of
            // inclusion, so the caller decides the nonce
            feePayer: { body: { nonce: "7" } },
        });
        expect(hash).toBe("tx-hash-123");
    });

    it("does not wait for inclusion", async () => {
        await broadcastProvedSettlement(PROVED_TX_JSON, 7, 80);

        // no polling dependency in scope: broadcast returns after send()
        expect(mockTx.sign).toHaveBeenCalledTimes(1);
    });

    it("throws when the node rejects the broadcast", async () => {
        mockTx.sign.mockReturnValueOnce({
            send: vi.fn().mockResolvedValue({
                hash: "tx-hash-123",
                status: "rejected",
                errors: ["Invalid_nonce"],
            }),
        } as any);

        await expect(
            broadcastProvedSettlement(PROVED_TX_JSON, 7, 80),
        ).rejects.toThrow("Settlement broadcast rejected");
    });
});

describe("mina settlement - fetchFeePayerLedgerNonce", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MINA_PRIVATE_KEY = "EKtest";
    });

    it("returns the ledger nonce as a number", async () => {
        await expect(fetchFeePayerLedgerNonce()).resolves.toBe(5);
    });

    it("throws when MINA_PRIVATE_KEY is not set", async () => {
        delete process.env.MINA_PRIVATE_KEY;

        await expect(fetchFeePayerLedgerNonce()).rejects.toThrow(
            "MINA_PRIVATE_KEY is not set",
        );
    });
});
