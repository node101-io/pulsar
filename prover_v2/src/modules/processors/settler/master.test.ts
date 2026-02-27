import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import {
    MASTER_SLEEP_INTERVAL_MS,
    PROOF_EPOCH_SETTLEMENT_INDEX,
} from "../../utils/constants.js";

vi.mock("../../db/index.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../utils/queue.js", () => ({
    settlerQ: {
        add: vi.fn(),
    },
}));

vi.mock("../utils/workerConnection.js", () => ({
    connection: {},
}));

vi.mock("./worker.js", () => ({
    worker: vi.fn(),
}));

vi.mock("../../utils/functions.js", () => ({
    sleep: vi.fn(),
}));

vi.mock("../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../db/index.js";
import { settlerQ } from "../utils/queue.js";
import { sleep } from "../../utils/functions.js";
import { SettlerMaster } from "./master.js";

describe("settler master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues settlement job when epoch found", async () => {
        const settlementProofId = new Types.ObjectId();
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);
        proofs[PROOF_EPOCH_SETTLEMENT_INDEX] = settlementProofId;

        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
            kind: "blockProof",
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).toHaveBeenCalledWith("settler", {
            height: 20,
            settlementProofId: settlementProofId.toString(),
        });
        expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps when no epoch", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back kind when queue add fails", async () => {
        const settlementProofId = new Types.ObjectId();
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);
        proofs[PROOF_EPOCH_SETTLEMENT_INDEX] = settlementProofId;

        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
            kind: "blockProof",
        } as any);
        vi.mocked(settlerQ.add).mockRejectedValueOnce(new Error("queue error"));

        const m = new SettlerMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 20, kind: "settlement" },
            { $set: { kind: "blockProof" } },
        );
    });

    it("sleeps when settlement proof id is missing", async () => {
        const proofs = Array(PROOF_EPOCH_SETTLEMENT_INDEX + 1).fill(null);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            proofs,
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });
});

