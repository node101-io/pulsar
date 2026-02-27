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
    SettlementContract: function SettlementContract(this: any) {
        this.settle = vi.fn().mockResolvedValue(undefined);
    },
    SettlementProof: {
        fromJSON: vi.fn(async () => ({})),
    },
}));

vi.mock("o1js", () => ({
    Mina: {
        Network: vi.fn(() => ({})),
        setActiveInstance: vi.fn(),
    },
    PublicKey: {
        fromBase58: vi.fn(() => ({})),
    },
    fetchAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("dotenv", () => ({
    default: { config: vi.fn() },
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
import { worker } from "./worker.js";

describe("settler worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.REMOTE_SERVER_URL = "remote";
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(
            worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" } as any),
        ).rejects.toThrow("ProofEpoch at height 10 not found.");
    });

    it("skips when already done after failure", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            failCount: 1,
            kind: "done",
        } as any);

        await worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" } as any);

        expect(getProof).not.toHaveBeenCalled();
        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("throws when settlement proof is missing", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            failCount: 0,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue(null as any);

        await expect(
            worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" } as any),
        ).rejects.toThrow("Settlement proof is missing.");
    });

    it("throws when contract address missing", async () => {
        delete process.env.CONTRACT_ADDRESS;
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            failCount: 0,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);

        await expect(
            worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" } as any),
        ).rejects.toThrow("Contract address is not specified");
    });

    it("sets epoch done after successful settlement", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 10,
            failCount: 0,
            kind: "settlement",
        } as any);
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await worker({ height: 10, settlementProofId: "507f1f77bcf86cd799439011" } as any);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 10, kind: "settlement" },
            { $set: { kind: "done" } },
        );
    });
});

