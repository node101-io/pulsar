import { describe, it, expect, vi, beforeEach } from "vitest";
import { MASTER_SLEEP_INTERVAL_MS } from "../../utils/constants.js";

vi.mock("../../db/index.js", () => ({
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementBlockEpochFailCount: vi.fn(),
}));

vi.mock("../utils/queue.js", () => ({
    blockProverQ: {
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

import { BlockEpochModel } from "../../db/index.js";
import { blockProverQ } from "../utils/queue.js";
import { sleep } from "../../utils/functions.js";
import { BlockProverMaster } from "./master.js";

describe("block-prover master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues exactly one job when epoch found", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
        } as any);

        const m = new BlockProverMaster() as any;
        await m.handleTask();

        expect(blockProverQ.add).toHaveBeenCalledTimes(1);
        expect(blockProverQ.add).toHaveBeenCalledWith("block-prover", {
            height: 8,
        });
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
