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
    proveSettlementTx: vi.fn(),
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
import { proveSettlementTx } from "../../mina/settlement.js";
import { worker } from "./worker.js";

describe("settlement-prover worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(
            worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" }),
        ).rejects.toThrow("ProofEpoch at height 10 not found.");
    });

    it("skips proving when epoch kind is settlement (idempotency)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "settlement",
        } as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(getProof).not.toHaveBeenCalled();
        expect(proveSettlementTx).not.toHaveBeenCalled();
    });

    it("skips proving when epoch kind is txSending (idempotency)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txSending",
        } as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(getProof).not.toHaveBeenCalled();
        expect(proveSettlementTx).not.toHaveBeenCalled();
    });

    it("skips proving when epoch kind is done (idempotency)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "done",
        } as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(getProof).not.toHaveBeenCalled();
        expect(proveSettlementTx).not.toHaveBeenCalled();
    });

    it("throws when settlement proof is missing", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue(null as any);

        await expect(
            worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" }),
        ).rejects.toThrow("Settlement proof is missing.");
    });

    it("calls proveSettlementTx with correct epochLastPulsarBlock", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(proveSettlementTx).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            // epoch.height (16) + BLOCK_EPOCH_SIZE (8) - 1 = 23
            23,
        );
    });

    it("stores provedTxJson and sets kind=settlement", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: "txProving" },
            { $set: { kind: "settlement", provedTxJson: "provedJson" } },
        );
    });

    it("stores null provedTxJson when epoch already settled on Mina", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue(null);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" });

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: "txProving" },
            { $set: { kind: "settlement", provedTxJson: null } },
        );
    });

    it("throws when epoch cannot be marked settlement (concurrent update race)", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        await expect(
            worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" }),
        ).rejects.toThrow(
            "Proof epoch at height 16 not found or not in txProving state.",
        );
    });

    it("propagates error from proveSettlementTx without updating DB", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockRejectedValue(
            new Error("prove failed"),
        );

        await expect(
            worker({ height: 16, settlementProofId: "507f1f77bcf86cd799439011" }),
        ).rejects.toThrow("prove failed");

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
