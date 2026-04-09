import { describe, it, expect, vi, beforeEach } from "vitest";
import { MASTER_SLEEP_INTERVAL_MS } from "../../config/constants.js";

vi.mock("../../db/index.js", () => ({
    ProofEpochModel: {
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../queue.js", () => ({
    settlerQ: {
        add: vi.fn(),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    },
}));

vi.mock("../redis.js", () => ({
    connection: {},
}));

vi.mock("./worker.js", () => ({
    worker: vi.fn(),
}));

vi.mock("../../common/sleep.js", () => ({
    sleep: vi.fn(),
}));

vi.mock("../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../db/index.js";
import { settlerQ } from "../queue.js";
import { sleep } from "../../common/sleep.js";
import { SettlerMaster } from "./master.js";

describe("settler master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues settler job when epoch in settlement state found", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            kind: "settlement",
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).toHaveBeenCalledWith("settler", {
            height: 20,
        });
        expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps when no epoch in settlement state", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(null as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back kind to settlement when queue add fails", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            kind: "settlement",
        } as any);
        vi.mocked(settlerQ.add).mockRejectedValueOnce(new Error("queue error"));

        const m = new SettlerMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 20, kind: "txSending" },
            { $set: { kind: "settlement" } },
        );
    });
});
