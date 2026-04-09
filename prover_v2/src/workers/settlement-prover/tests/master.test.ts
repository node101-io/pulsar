import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import {
    MASTER_SLEEP_INTERVAL_MS,
    PROOF_EPOCH_SETTLEMENT_INDEX,
} from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../../queue.js", () => ({
    settlementProverQ: {
        add: vi.fn(),
    },
}));

vi.mock("../redis.js", () => ({
    connection: {},
}));

vi.mock("../worker.js", () => ({
    worker: vi.fn(),
}));

vi.mock("../../../common/sleep.js", () => ({
    sleep: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../../db/index.js";
import { settlementProverQ } from "../../queue.js";
import { sleep } from "../../../common/sleep.js";
import { SettlementProverMaster } from "../master.js";

describe("settlement-prover master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues settlement-prover job when epoch found", async () => {
        const settlementProofId = new Types.ObjectId();
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);
        proofs[PROOF_EPOCH_SETTLEMENT_INDEX] = settlementProofId;

        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
            kind: "aggregation",
        } as any);

        const m = new SettlementProverMaster() as any;
        await m.handleTask();

        expect(settlementProverQ.add).toHaveBeenCalledWith("settlement-prover", {
            height: 20,
            settlementProofId: settlementProofId.toString(),
        });
        expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps when no epoch found", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        const m = new SettlementProverMaster() as any;
        await m.handleTask();

        expect(settlementProverQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back kind to original when queue add fails", async () => {
        const settlementProofId = new Types.ObjectId();
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);
        proofs[PROOF_EPOCH_SETTLEMENT_INDEX] = settlementProofId;

        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
            kind: "aggregation",
        } as any);
        vi.mocked(settlementProverQ.add).mockRejectedValueOnce(
            new Error("queue error"),
        );

        const m = new SettlementProverMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 20, kind: "txProving" },
            { $set: { kind: "aggregation" } },
        );
    });

    it("sleeps when settlement proof id is null despite query match", async () => {
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);

        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
            kind: "blockProof",
        } as any);

        const m = new SettlementProverMaster() as any;
        await m.handleTask();

        expect(settlementProverQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });
});
