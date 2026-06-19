import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/models/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn(() => ({})),
    },
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({ network: "lightnet" })),
}));

vi.mock("../../../services/mina/settlement.js", () => ({
    sendProvedSettlement: vi.fn(),
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
import { sendProvedSettlement } from "../../../services/mina/settlement.js";
import { worker } from "../worker.js";

describe("settler worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(worker({ height: 10 })).rejects.toThrow(
            "ProofEpoch at height 10 not found.",
        );
    });

    it("skips when epoch is already done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            kind: "done",
            provedTxJson: "someJson",
        } as any);

        await worker({ height: 10 });

        expect(sendProvedSettlement).not.toHaveBeenCalled();
    });

    it("skips send and marks done when provedTxJson is null (pre-settled on Mina)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
            provedTxJson: null,
        } as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16 });

        expect(sendProvedSettlement).not.toHaveBeenCalled();
        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: { $in: ["txSending", "settlement"] } },
            { $set: { kind: "done" } },
        );
    });

    it("calls sendProvedSettlement with correct provedTxJson and epochLastPulsarBlock", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
            provedTxJson: "theProvedJson",
        } as any);
        vi.mocked(sendProvedSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16 });

        expect(sendProvedSettlement).toHaveBeenCalledWith(
            expect.anything(),
            "theProvedJson",
            // epoch.height (16) + BLOCK_EPOCH_SIZE (8) - 1 = 23
            23,
        );
    });

    it("marks epoch as done after successful send", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
            provedTxJson: "theProvedJson",
        } as any);
        vi.mocked(sendProvedSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16 });

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: { $in: ["txSending", "settlement"] } },
            { $set: { kind: "done" } },
        );
    });

    it("throws when epoch cannot be marked done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
            provedTxJson: "theProvedJson",
        } as any);
        vi.mocked(sendProvedSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        await expect(worker({ height: 16 })).rejects.toThrow(
            "Proof epoch at height 16 not found or not in txSending/settlement state.",
        );
    });

    it("propagates error from sendProvedSettlement without marking done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
            provedTxJson: "theProvedJson",
        } as any);
        vi.mocked(sendProvedSettlement).mockRejectedValue(
            new Error("Settlement send failed after 3 attempts for block 23"),
        );

        await expect(worker({ height: 16 })).rejects.toThrow(
            "Settlement send failed after 3 attempts for block 23",
        );

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
