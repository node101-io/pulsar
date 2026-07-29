import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        updateOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
    BlockModel: {
        findOneAndUpdate: vi.fn(),
    },
    storeProof: vi.fn(),
    fetchBlockRange: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import {
    BlockEpochModel,
    BlockModel,
    ProofEpochModel,
    fetchBlockRange,
    storeProof,
} from "../../../db/index.js";
import { worker } from "../worker.js";

describe("block-prover worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marks the block done and skips when epoch not found or not processing", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue(
            null as any,
        );

        await worker({ height: 8, blockIndex: 2 } as any);

        expect(BlockModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 10 },
            { $set: { status: "done" } },
        );
        expect(fetchBlockRange).not.toHaveBeenCalled();
        expect(storeProof).not.toHaveBeenCalled();
    });

    it("returns without proving while other blocks in the epoch are pending", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
            failCount: 0,
            status: ["done", "done", "waiting", "done", "done", "done", "done", "done"],
        } as any);

        await worker({ height: 8, blockIndex: 1 } as any);

        expect(ProofEpochModel.findOne).not.toHaveBeenCalled();
        expect(fetchBlockRange).not.toHaveBeenCalled();
        expect(storeProof).not.toHaveBeenCalled();
    });

    it("skips proof generation when proofs already exist after failures", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
            failCount: 1,
            status: Array(8).fill("done"),
        } as any);
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 8,
            kind: "blockProof",
            proofs: [1, null],
        } as any);

        await worker({ height: 8, blockIndex: 7 } as any);

        expect(fetchBlockRange).not.toHaveBeenCalled();
        expect(storeProof).not.toHaveBeenCalled();
        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenLastCalledWith(
            { height: 8 },
            { $set: { epochStatus: "done" } },
        );
    });
});
