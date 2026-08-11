import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    BLOCK_EPOCH_SIZE,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
        updateMany: vi.fn(),
    },
    ProofEpochModel: {
        find: vi.fn(),
    },
    incrementBlockEpochFailCount: vi.fn(),
}));

vi.mock("../../queue.js", () => ({
    blockProverQ: {
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

import { BlockEpochModel, ProofEpochModel } from "../../../db/index.js";
import { blockProverQ } from "../../queue.js";
import { sleep } from "../../../common/sleep.js";
import { BlockProverMaster } from "../master.js";

describe("block-prover master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ProofEpochModel.find).mockResolvedValue([] as any);
    });

    it("queues one job per block of the epoch when epoch found", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
        } as any);

        const m = new BlockProverMaster() as any;
        await m.handleTask();

        expect(blockProverQ.add).toHaveBeenCalledTimes(BLOCK_EPOCH_SIZE);
        for (let i = 0; i < BLOCK_EPOCH_SIZE; i++) {
            expect(blockProverQ.add).toHaveBeenNthCalledWith(
                i + 1,
                "block-prover",
                { height: 8, blockIndex: i },
            );
        }
        expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps when no epoch", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue(
            null as any,
        );

        const m = new BlockProverMaster() as any;
        await m.handleTask();

        expect(blockProverQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back epochStatus when queue add fails", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
        } as any);
        vi.mocked(blockProverQ.add).mockRejectedValueOnce(
            new Error("queue error"),
        );

        const m = new BlockProverMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 8, epochStatus: "processing" },
            { $set: { epochStatus: "waiting" } },
        );
    });

    it("recovers only stale processing epochs (age-gated sweep)", async () => {
        vi.mocked(BlockEpochModel.updateMany).mockResolvedValue({
            modifiedCount: 1,
        } as any);

        const m = new BlockProverMaster() as any;
        await m.recoverStaleClaims();

        expect(BlockEpochModel.updateMany).toHaveBeenCalledWith(
            // the age gate is what keeps sibling instances from stealing
            // each other's live work under pm2 scale
            { epochStatus: "processing", updatedAt: { $lt: expect.any(Date) } },
            { $set: { epochStatus: "waiting" } },
        );
        const cutoff = (vi.mocked(BlockEpochModel.updateMany).mock
            .calls[0][0] as any).updatedAt.$lt;
        expect(cutoff.getTime()).toBeLessThan(Date.now());
    });

    it("re-queues a done block epoch whose leaf is missing (reconciliation)", async () => {
        vi.mocked(BlockEpochModel.updateMany).mockResolvedValue({
            modifiedCount: 0,
        } as any);
        vi.mocked(ProofEpochModel.find).mockResolvedValue([
            // leaf 1 missing; leaves 0,2,3 present
            { height: 100, proofs: [{}, null, {}, {}, null, null, null] },
        ] as any);
        vi.mocked(BlockEpochModel.updateOne).mockResolvedValue({
            modifiedCount: 1,
        } as any);

        const m = new BlockProverMaster() as any;
        await m.recoverStaleClaims();

        expect(BlockEpochModel.updateOne).toHaveBeenCalledTimes(1);
        expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
            {
                height: 100 + BLOCK_EPOCH_SIZE,
                epochStatus: "done",
                updatedAt: { $lt: expect.any(Date) },
            },
            {
                $set: {
                    epochStatus: "waiting",
                    status: Array(BLOCK_EPOCH_SIZE).fill("waiting"),
                    failCount: 0,
                },
            },
        );
    });
});
