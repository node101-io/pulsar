import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/models/proofEpoch/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("../../db/models/proof/utils.js", () => ({
    getProof: vi.fn(),
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {
        fromJSON: vi.fn(async () => ({})),
    },
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn(() => ({})),
    },
}));

vi.mock("../../mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({ network: "lightnet" })),
}));

vi.mock("../../mina/settlement.js", () => ({
    submitSettlement: vi.fn(),
}));

vi.mock("../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof } from "../../db/models/proof/utils.js";
import { submitSettlement } from "../../mina/settlement.js";
import { worker } from "./worker.js";

describe("settler worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(
            worker({
                height: 10,
                settlementProofId: "507f1f77bcf86cd799439011",
            } as any),
        ).rejects.toThrow("ProofEpoch at height 10 not found.");
    });

    it("skips when epoch is already done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            kind: "done",
        } as any);

        await worker({
            height: 10,
            settlementProofId: "507f1f77bcf86cd799439011",
        } as any);

        expect(getProof).not.toHaveBeenCalled();
        expect(submitSettlement).not.toHaveBeenCalled();
    });

    it("throws when settlement proof is missing", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue(null as any);

        await expect(
            worker({
                height: 10,
                settlementProofId: "507f1f77bcf86cd799439011",
            } as any),
        ).rejects.toThrow("Settlement proof is missing.");
    });

    it("calls submitSettlement with correct epochLastPulsarBlock", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(submitSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(
            {} as any,
        );

        await worker({
            height: 16,
            settlementProofId: "507f1f77bcf86cd799439011",
        } as any);

        expect(submitSettlement).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            // epoch.height (16) + BLOCK_EPOCH_SIZE (8) - 1 = 23
            23,
        );
    });

    it("marks epoch as done after successful settlement", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(submitSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(
            {} as any,
        );

        await worker({
            height: 16,
            settlementProofId: "507f1f77bcf86cd799439011",
        } as any);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: "settlement" },
            { $set: { kind: "done" } },
        );
    });

    it("throws when epoch cannot be marked done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(submitSettlement).mockResolvedValue(undefined);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(
            null as any,
        );

        await expect(
            worker({
                height: 16,
                settlementProofId: "507f1f77bcf86cd799439011",
            } as any),
        ).rejects.toThrow(
            "Proof epoch at height 16 not found or not in settlement state.",
        );
    });

    it("propagates error from submitSettlement without marking done", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(submitSettlement).mockRejectedValue(
            new Error("Settlement failed after 3 attempts for block 23"),
        );

        await expect(
            worker({
                height: 16,
                settlementProofId: "507f1f77bcf86cd799439011",
            } as any),
        ).rejects.toThrow("Settlement failed after 3 attempts for block 23");

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
