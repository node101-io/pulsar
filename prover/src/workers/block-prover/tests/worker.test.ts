import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
    },
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
    BlockModel: {
        findOneAndUpdate: vi.fn(),
    },
}));

vi.mock("../../childProver.js", () => ({
    runProvingJobInChild: vi.fn(),
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
} from "../../../db/index.js";
import { runProvingJobInChild } from "../../childProver.js";
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
        expect(runProvingJobInChild).not.toHaveBeenCalled();
    });

    it("returns without proving while other blocks in the epoch are pending", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
            failCount: 0,
            status: ["done", "done", "waiting", "done", "done", "done", "done", "done"],
        } as any);

        await worker({ height: 8, blockIndex: 1 } as any);

        expect(ProofEpochModel.findOne).not.toHaveBeenCalled();
        expect(runProvingJobInChild).not.toHaveBeenCalled();
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

        expect(runProvingJobInChild).not.toHaveBeenCalled();
        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenLastCalledWith(
            { height: 8 },
            { $set: { epochStatus: "done" } },
        );
    });

    it("re-proves when its own leaf is missing even if sibling leaves exist", async () => {
        // block epoch 18 -> leaf index 2 with EPOCH_START_HEIGHT=2
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 18,
            failCount: 1,
            status: Array(8).fill("done"),
        } as any);
        // sibling leaves present, OWN slot (2) empty — the old any-slot
        // check skipped here and wedged the proof epoch permanently
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 2,
            kind: "blockProof",
            proofs: [{}, {}, null, {}],
        } as any);

        await worker({ height: 18, blockIndex: 7 } as any);

        expect(runProvingJobInChild).toHaveBeenCalledWith(
            expect.stringContaining("prove-main.js"),
            ["18"],
            { epochHeight: 18 },
        );
    });

    it("returns the claim to waiting when the proving child fails", async () => {
        // The child owns the leaf and the done-mark, so the only thing the
        // parent has to undo is its own claim — otherwise the epoch stays
        // 'processing' and only the age-gated sweep can free it.
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 18,
            failCount: 0,
            status: Array(8).fill("done"),
        } as any);
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 2,
            kind: "blockProof",
            proofs: [{}, {}, null, {}],
        } as any);
        vi.mocked(runProvingJobInChild).mockRejectedValue(
            new Error("prover froze"),
        );

        await expect(
            worker({ height: 18, blockIndex: 7 } as any),
        ).rejects.toThrow("prover froze");

        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenLastCalledWith(
            { height: 18 },
            { $set: { epochStatus: "waiting" } },
        );
    });
});
