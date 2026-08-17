import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";

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

import { runProvingJobInChild } from "../../childProver.js";
import { worker } from "../worker.js";

describe("aggregator worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips when already done after failure", async () => {
        const task: any = { height: 1, failCount: 1, status: ["done"] };
        const aggregation: any = {
            left: new Types.ObjectId(),
            right: new Types.ObjectId(),
            index: 0,
        };

        await worker(task, aggregation);

        expect(runProvingJobInChild).not.toHaveBeenCalled();
    });

    it("hands the pair to a proving child", async () => {
        const left = new Types.ObjectId();
        const right = new Types.ObjectId();
        const task: any = { height: 10, failCount: 0, status: ["waiting"] };

        await worker(task, { left, right, index: 0 } as any);

        expect(runProvingJobInChild).toHaveBeenCalledWith(
            expect.stringContaining("prove-main.js"),
            ["10", left.toString(), right.toString(), "0"],
            { epochHeight: 10, index: 0 },
        );
    });

    it("propagates a failing child so the master can strike the epoch", async () => {
        vi.mocked(runProvingJobInChild).mockRejectedValue(
            new Error("prover froze"),
        );
        const task: any = { height: 10, failCount: 0, status: ["waiting"] };

        await expect(
            worker(task, {
                left: new Types.ObjectId(),
                right: new Types.ObjectId(),
                index: 0,
            } as any),
        ).rejects.toThrow("prover froze");
    });
});
