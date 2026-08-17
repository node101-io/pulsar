import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { epochLastPulsarBlock } from "../../../common/epoch.js";

vi.mock("../../../db/models/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("../../../db/models/Proof.js", () => ({
    getProof: vi.fn(),
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {
        fromJSON: vi.fn(async () => ({})),
    },
    MultisigVerifierProgram: { compile: vi.fn(async () => ({})) },
    SettleAttestProgram: { compile: vi.fn(async () => ({})) },
    ApprovalTailProgram: { compile: vi.fn(async () => ({})) },
    ApprovalQuorumProgram: { compile: vi.fn(async () => ({})) },
    ActionStackProgram: { compile: vi.fn(async () => ({})) },
    SettlementContract: { compile: vi.fn(async () => ({})) },
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn(() => ({})),
    },
    // config/cache.ts builds the shared compile cache at module load.
    Cache: { FileSystem: vi.fn(() => ({})) },
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({ network: "lightnet" })),
}));

vi.mock("../../../services/mina/settlement.js", () => ({
    proveSettlementTx: vi.fn(),
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
import { getProof } from "../../../db/models/Proof.js";
import { proveSettlementTx } from "../../../services/mina/settlement.js";
import { proveSettlement } from "../proving.js";

const PROOF_ID = new Types.ObjectId("507f1f77bcf86cd799439011");

describe("settlement-prover proving", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it("throws when settlement proof is missing", async () => {
        vi.mocked(getProof).mockResolvedValue(null as any);

        await expect(proveSettlement(16, PROOF_ID)).rejects.toThrow(
            "Settlement proof is missing.",
        );
    });

    it("calls proveSettlementTx with correct epochLastPulsarBlock", async () => {
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await proveSettlement(16, PROOF_ID);

        expect(proveSettlementTx).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            // epoch 16 spans blocks 16..47, so settling it lands at 47
            epochLastPulsarBlock(16),
        );
    });

    it("stores provedTxJson and sets kind=settlement", async () => {
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await proveSettlement(16, PROOF_ID);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: "txProving" },
            { $set: { kind: "settlement", provedTxJson: "provedJson" } },
        );
    });

    it("stores null provedTxJson when epoch already settled on Mina", async () => {
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue(null);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await proveSettlement(16, PROOF_ID);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 16, kind: "txProving" },
            { $set: { kind: "settlement", provedTxJson: null } },
        );
    });

    it("throws when epoch cannot be marked settlement (concurrent update race)", async () => {
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockResolvedValue("provedJson");
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        await expect(proveSettlement(16, PROOF_ID)).rejects.toThrow(
            "Proof epoch at height 16 not found or not in txProving state.",
        );
    });

    it("propagates error from proveSettlementTx without updating DB", async () => {
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(proveSettlementTx).mockRejectedValue(
            new Error("prove failed"),
        );

        await expect(proveSettlement(16, PROOF_ID)).rejects.toThrow(
            "prove failed",
        );

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
