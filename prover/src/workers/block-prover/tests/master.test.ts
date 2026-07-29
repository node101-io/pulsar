import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    BLOCK_EPOCH_SIZE,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
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

import { BlockEpochModel } from "../../../db/index.js";
import { blockProverQ } from "../../queue.js";
import { sleep } from "../../../common/sleep.js";
import { BlockProverMaster } from "../master.js";

describe("block-prover master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
