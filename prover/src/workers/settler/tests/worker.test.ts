import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROOF_EPOCH_SIZE, SETTLER_WINDOW } from "../../../config/constants.js";
import { epochLastPulsarBlock } from "../../../common/epoch.js";

vi.mock("../../../db/models/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        countDocuments: vi.fn(),
        updateOne: vi.fn(),
    },
}));

vi.mock("../../../db/models/MinaState.js", () => ({
    getLastSentNonce: vi.fn(),
    saveLastSentNonce: vi.fn(),
}));

vi.mock("../../../services/mina/settlement.js", () => ({
    broadcastProvedSettlement: vi.fn(),
    fetchFeePayerLedgerNonce: vi.fn(),
}));

vi.mock("../finalize.js", () => ({
    finalizeSettledEpoch: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../../db/models/ProofEpoch.js";
import {
    getLastSentNonce,
    saveLastSentNonce,
} from "../../../db/models/MinaState.js";
import {
    broadcastProvedSettlement,
    fetchFeePayerLedgerNonce,
} from "../../../services/mina/settlement.js";
import { finalizeSettledEpoch } from "../finalize.js";
import { worker } from "../worker.js";

const HEIGHT = 100;

/** findOne answers: first call = the epoch, second call = its predecessor. */
function mockEpochAndPredecessor(epoch: any, predecessor: any) {
    vi.mocked(ProofEpochModel.findOne)
        .mockResolvedValueOnce(epoch)
        .mockResolvedValueOnce(predecessor);
}

describe("settler worker (pipelined send)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ProofEpochModel.countDocuments).mockResolvedValue(0);
        vi.mocked(getLastSentNonce).mockResolvedValue(null);
        vi.mocked(fetchFeePayerLedgerNonce).mockResolvedValue(3);
        vi.mocked(broadcastProvedSettlement).mockResolvedValue("tx-hash-abc");
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(worker({ height: HEIGHT })).rejects.toThrow(
            `ProofEpoch at height ${HEIGHT} not found.`,
        );
    });

    it("is a no-op when the epoch is no longer claimed (stale job)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: HEIGHT,
            kind: "txSent",
            provedTxJson: "json",
        } as any);

        await worker({ height: HEIGHT });

        expect(broadcastProvedSettlement).not.toHaveBeenCalled();
        expect(ProofEpochModel.updateOne).not.toHaveBeenCalled();
    });

    it("finalizes without sending when the epoch was pre-settled during proving", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: HEIGHT,
            kind: "txSending",
            provedTxJson: null,
        } as any);

        await worker({ height: HEIGHT });

        expect(finalizeSettledEpoch).toHaveBeenCalledWith(HEIGHT);
        expect(broadcastProvedSettlement).not.toHaveBeenCalled();
    });

    it("throws when the predecessor is neither settled nor in flight", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            { height: HEIGHT - PROOF_EPOCH_SIZE, kind: "settlement" },
        );

        await expect(worker({ height: HEIGHT })).rejects.toThrow(
            `Cannot send epoch ${HEIGHT}`,
        );
        expect(broadcastProvedSettlement).not.toHaveBeenCalled();
    });

    it("sends when the predecessor is in flight (txSent)", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            { height: HEIGHT - PROOF_EPOCH_SIZE, kind: "txSent" },
        );

        await worker({ height: HEIGHT });

        expect(broadcastProvedSettlement).toHaveBeenCalledTimes(1);
    });

    it("sends when the predecessor document is missing (first epoch or reaped)", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            null,
        );

        await worker({ height: HEIGHT });

        expect(broadcastProvedSettlement).toHaveBeenCalledWith(
            "json",
            3, // lastSentNonce null -> seeded from the ledger
            epochLastPulsarBlock(HEIGHT),
        );
    });

    it("returns the claim when the send window is full", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            null,
        );
        vi.mocked(ProofEpochModel.countDocuments).mockResolvedValue(
            SETTLER_WINDOW,
        );

        await worker({ height: HEIGHT });

        expect(broadcastProvedSettlement).not.toHaveBeenCalled();
        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: HEIGHT, kind: "txSending" },
            { $set: { kind: "settlement" } },
        );
    });

    it("advances past the ledger nonce while txs are in flight", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            null,
        );
        vi.mocked(fetchFeePayerLedgerNonce).mockResolvedValue(3);
        vi.mocked(getLastSentNonce).mockResolvedValue(7); // pipeline is ahead

        await worker({ height: HEIGHT });

        expect(broadcastProvedSettlement).toHaveBeenCalledWith(
            "json",
            8, // max(ledger 3, lastSent 7 + 1)
            epochLastPulsarBlock(HEIGHT),
        );
        expect(saveLastSentNonce).toHaveBeenCalledWith(8);
    });

    it("records the sent tx on the epoch", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            null,
        );

        await worker({ height: HEIGHT });

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: HEIGHT, kind: "txSending" },
            {
                $set: {
                    kind: "txSent",
                    sentTxHash: "tx-hash-abc",
                    sentNonce: 3,
                    sentAt: expect.any(Date),
                },
            },
        );
    });

    it("leaves the epoch claimed when the broadcast throws (master resets it)", async () => {
        mockEpochAndPredecessor(
            { height: HEIGHT, kind: "txSending", provedTxJson: "json" },
            null,
        );
        vi.mocked(broadcastProvedSettlement).mockRejectedValue(
            new Error("Settlement broadcast rejected by the node"),
        );

        await expect(worker({ height: HEIGHT })).rejects.toThrow(
            "broadcast rejected",
        );

        expect(saveLastSentNonce).not.toHaveBeenCalled();
        expect(ProofEpochModel.updateOne).not.toHaveBeenCalled();
    });
});
