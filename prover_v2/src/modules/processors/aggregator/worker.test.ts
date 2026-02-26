import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { PROOF_EPOCH_LEAF_COUNT } from "../../utils/constants.js";

vi.mock("../../db/models/proofEpoch/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("../../db/models/proof/utils.js", () => ({
    getProof: vi.fn(),
    storeProof: vi.fn(),
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {
        fromJSON: vi.fn(async (j: any) => ({ j })),
    },
    MergeSettlementProofs: vi.fn(async () => ({
        toJSON: () => ({ merged: true }),
    })),
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
import { getProof, storeProof } from "../../db/models/proof/utils.js";
import { worker } from "./worker.js";

describe("aggregator worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips when already done after failure", async () => {
        const task: any = { height: 1, failCount: 1, status: ["done"] };
        const aggregation: any = {
            left: new Types.ObjectId(),
            right: new Types.ObjectId(),
            index: 0,
        };

        await worker(task, aggregation);

        expect(getProof).not.toHaveBeenCalled();
        expect(storeProof).not.toHaveBeenCalled();
        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("throws when one of proofs is missing", async () => {
        vi.mocked(getProof).mockResolvedValueOnce(null as any);
        vi.mocked(getProof).mockResolvedValueOnce({} as any);

        const task: any = { height: 1, failCount: 0, status: ["waiting"] };
        const aggregation: any = {
            left: new Types.ObjectId(),
            right: new Types.ObjectId(),
            index: 0,
        };

        await expect(worker(task, aggregation)).rejects.toThrow(
            "One of the proofs to aggregate is missing.",
        );
    });

    it("stores aggregated proof and marks status done", async () => {
        const aggId = new Types.ObjectId();
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(storeProof).mockResolvedValue(aggId as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        const task: any = { height: 10, failCount: 0, status: ["waiting"] };
        const aggregation: any = {
            left: new Types.ObjectId(),
            right: new Types.ObjectId(),
            index: 0,
        };

        await worker(task, aggregation);

        expect(storeProof).toHaveBeenCalledWith(JSON.stringify({ merged: true }));
        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 10 },
            {
                $set: {
                    [`proofs.${PROOF_EPOCH_LEAF_COUNT + 0}`]: aggId,
                    [`status.0`]: "done",
                },
            },
        );
    });
});

