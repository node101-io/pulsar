import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { MASTER_SLEEP_INTERVAL_MS } from "../../utils/constants.js";

vi.mock("../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        updateOne: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../utils/queue.js", () => ({
    aggregatorQ: {
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

import { ProofEpochModel } from "../../db/index.js";
import { aggregatorQ } from "../utils/queue.js";
import { sleep } from "../../utils/functions.js";
import { AggregatorMaster } from "./master.js";

describe("aggregator master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("queues available aggregation jobs and marks status processing", async () => {
        const left = new Types.ObjectId();
        const right = new Types.ObjectId();
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            _id: new Types.ObjectId(),
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

        expect(ProofEpochModel.updateOne).toHaveBeenCalled();
        expect(aggregatorQ.add).toHaveBeenCalledWith("aggregator", {
            height: 10,
            index: 0,
            left: left.toString(),
            right: right.toString(),
        });
        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: expect.anything(),
            }),
            expect.objectContaining({
                $set: { "status.0": "processing" },
            }),
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
});

