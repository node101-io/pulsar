import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { MASTER_SLEEP_INTERVAL_MS } from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../../queue.js", () => ({
    aggregatorQ: {
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

import { ProofEpochModel } from "../../../db/index.js";
import { aggregatorQ } from "../../queue.js";
import { sleep } from "../../../common/sleep.js";
import { AggregatorMaster } from "../master.js";

describe("aggregator master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues available aggregation jobs and marks status processing", async () => {
        const left = new Types.ObjectId();
        const right = new Types.ObjectId();
        const id = new Types.ObjectId();
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            _id: id,
            height: 10,
            proofs: [left, right],
            status: ["waiting"],
            timeoutAt: new Date(Date.now() + 1000),
        } as any);
        vi.mocked(ProofEpochModel.updateOne).mockResolvedValue({
            modifiedCount: 1,
        } as any);

        const m = new AggregatorMaster() as any;
        await m.handleTask();

        expect(ProofEpochModel.updateOne).toHaveBeenCalledTimes(1);
        expect(aggregatorQ.add).toHaveBeenCalledWith("aggregator", {
            height: 10,
            index: 0,
            left: left.toString(),
            right: right.toString(),
        });
        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            {
                _id: id,
                "proofs.0": { $ne: null },
                "proofs.1": { $ne: null },
                "status.0": { $eq: "waiting" },
            },
            { $set: { "status.0": "processing" } },
        );
        expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps when no epoch", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        const m = new AggregatorMaster() as any;
        await m.handleTask();

        expect(aggregatorQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back status when queue add fails", async () => {
        const left = new Types.ObjectId();
        const right = new Types.ObjectId();
        const id = new Types.ObjectId();
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            _id: id,
            height: 10,
            proofs: [left, right],
            status: ["waiting"],
            timeoutAt: new Date(Date.now() + 1000),
        } as any);
        vi.mocked(ProofEpochModel.updateOne).mockResolvedValueOnce({
            modifiedCount: 1,
        } as any);
        vi.mocked(aggregatorQ.add).mockRejectedValueOnce(
            new Error("queue error"),
        );

        const m = new AggregatorMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        const calls = vi.mocked(ProofEpochModel.updateOne).mock.calls;
        expect(calls[1][0]).toEqual({
            _id: id,
            "status.0": { $eq: "processing" },
        });
        expect(calls[1][1]).toEqual({
            $set: { "status.0": "waiting" },
        });
    });
});
