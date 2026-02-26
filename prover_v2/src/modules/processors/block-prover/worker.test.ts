import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("mongoose", () => {
    const startSession = vi.fn(async () => ({
        withTransaction: async (fn: any) => await fn(),
        endSession: async () => {},
    }));
    return { default: { startSession }, startSession };
});

vi.mock("../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
    },
    BlockEpochModel: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
    storeProof: vi.fn(),
    fetchBlockRange: vi.fn(),
}));

vi.mock("../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { BlockEpochModel, ProofEpochModel, fetchBlockRange, storeProof } from "../../db/index.js";
import { worker } from "./worker.js";

describe("block-prover worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws when epoch not found", async () => {
        vi.mocked(BlockEpochModel.findOne).mockResolvedValue(null as any);

        await expect(worker({ height: 8 } as any)).rejects.toThrow(
            "BlockEpoch at height 8 not found.",
        );
    });

    it("skips proof generation when proofs already exist after failures", async () => {
        vi.mocked(BlockEpochModel.findOne).mockResolvedValue({
            height: 8,
            failCount: 1,
            epochStatus: "processing",
        } as any);
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 8,
            kind: "blockProof",
            proofs: [1, null],
        } as any);

        await worker({ height: 8 } as any);

        expect(fetchBlockRange).not.toHaveBeenCalled();
        expect(storeProof).not.toHaveBeenCalled();
        expect(BlockEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});

