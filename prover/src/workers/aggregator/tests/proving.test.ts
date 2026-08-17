import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { PROOF_EPOCH_LEAF_COUNT } from "../../../config/constants.js";

vi.mock("../../../db/models/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("../../../db/models/Proof.js", () => ({
    getProof: vi.fn(),
    storeProof: vi.fn(),
}));

vi.mock("o1js", () => ({
    Cache: { FileSystem: vi.fn(() => ({})) },
}));

vi.mock("pulsar-contracts", () => ({
    SettlementProof: {
        fromJSON: vi.fn(async (j: any) => ({ j })),
    },
    MergeSettlementProofs: vi.fn(async () => ({
        toJSON: () => ({ merged: true }),
    })),
    MultisigVerifierProgram: {
        compile: vi.fn(async () => ({})),
    },
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
import { getProof, storeProof } from "../../../db/models/Proof.js";
import { proveAggregation } from "../proving.js";

describe("aggregator proving", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws when one of proofs is missing", async () => {
        vi.mocked(getProof).mockResolvedValueOnce(null as any);
        vi.mocked(getProof).mockResolvedValueOnce({} as any);

        await expect(
            proveAggregation(
                1,
                new Types.ObjectId(),
                new Types.ObjectId(),
                0,
            ),
        ).rejects.toThrow("One of the proofs to aggregate is missing.");
    });

    it("stores aggregated proof and marks status done", async () => {
        const aggId = new Types.ObjectId();
        vi.mocked(getProof).mockResolvedValue({} as any);
        vi.mocked(storeProof).mockResolvedValue(aggId as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await proveAggregation(
            10,
            new Types.ObjectId(),
            new Types.ObjectId(),
            0,
        );

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
