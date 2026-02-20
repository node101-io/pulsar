import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    startMonitor,
    checkBlockEpochs,
    checkProofEpochs,
} from "./monitor.js";
import { BlockEpochModel } from "../db/models/blockEpoch/BlockEpoch.js";
import { ProofEpochModel } from "../db/models/proofEpoch/ProofEpoch.js";
import { MAX_FAIL_COUNT, MONITOR_INTERVAL_MS } from "../utils/constants.js";
import * as functions from "../utils/functions.js";

vi.mock("../db/models/blockEpoch/BlockEpoch.js");
vi.mock("../db/models/proofEpoch/ProofEpoch.js");
vi.mock("../utils/functions.js");
vi.mock("../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("monitor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(functions.sleep).mockResolvedValue(undefined);
    });

    describe("checkBlockEpochs", () => {
        it("marks block epochs as failed when failCount exceeds MAX_FAIL_COUNT", async () => {
            const mockEpochs = [
                {
                    height: 8,
                    failCount: MAX_FAIL_COUNT + 1,
                    epochStatus: "processing",
                },
                {
                    height: 16,
                    failCount: MAX_FAIL_COUNT + 2,
                    epochStatus: "waiting",
                },
            ];

            vi.mocked(BlockEpochModel.find).mockResolvedValue(mockEpochs as any);
            vi.mocked(BlockEpochModel.updateOne).mockResolvedValue({} as any);

            const count = await checkBlockEpochs();

            expect(count).toBe(2);
            expect(BlockEpochModel.find).toHaveBeenCalledWith({
                failCount: { $gt: MAX_FAIL_COUNT },
                epochStatus: { $ne: "failed" },
            });
            expect(BlockEpochModel.updateOne).toHaveBeenCalledTimes(2);
            expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
                { height: 8 },
                { $set: { epochStatus: "failed" } },
            );
            expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
                { height: 16 },
                { $set: { epochStatus: "failed" } },
            );
        });

        it("does not mark epochs that are already failed", async () => {
            vi.mocked(BlockEpochModel.find).mockResolvedValue([]);

            const count = await checkBlockEpochs();

            expect(count).toBe(0);
            expect(BlockEpochModel.updateOne).not.toHaveBeenCalled();
        });

        it("does not mark epochs with failCount <= MAX_FAIL_COUNT", async () => {
            vi.mocked(BlockEpochModel.find).mockResolvedValue([]);

            const count = await checkBlockEpochs();

            expect(count).toBe(0);
            expect(BlockEpochModel.updateOne).not.toHaveBeenCalled();
        });
    });

    describe("checkProofEpochs", () => {
        it("marks proof epochs as failed when failCount exceeds MAX_FAIL_COUNT", async () => {
            const mockEpochs = [
                {
                    height: 8,
                    failCount: MAX_FAIL_COUNT + 1,
                    status: ["waiting", "processing", "done"],
                    kind: "blockProof",
                },
                {
                    height: 16,
                    failCount: MAX_FAIL_COUNT + 2,
                    status: ["waiting", "waiting"],
                    kind: "aggregation",
                },
            ];

            vi.mocked(ProofEpochModel.find).mockResolvedValue(mockEpochs as any);
            vi.mocked(ProofEpochModel.updateOne).mockResolvedValue({} as any);

            const count = await checkProofEpochs();

            expect(count).toBe(2);
            expect(ProofEpochModel.find).toHaveBeenCalledWith({
                failCount: { $gt: MAX_FAIL_COUNT },
                status: { $not: { $all: ["failed"] } },
            });
            expect(ProofEpochModel.updateOne).toHaveBeenCalledTimes(2);
            expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
                { height: 8 },
                { $set: { status: ["failed", "failed", "failed"] } },
            );
            expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
                { height: 16 },
                { $set: { status: ["failed", "failed"] } },
            );
        });

        it("does not mark epochs that are already fully failed", async () => {
            vi.mocked(ProofEpochModel.find).mockResolvedValue([]);

            const count = await checkProofEpochs();

            expect(count).toBe(0);
            expect(ProofEpochModel.updateOne).not.toHaveBeenCalled();
        });

        it("does not mark epochs with failCount <= MAX_FAIL_COUNT", async () => {
            vi.mocked(ProofEpochModel.find).mockResolvedValue([]);

            const count = await checkProofEpochs();

            expect(count).toBe(0);
            expect(ProofEpochModel.updateOne).not.toHaveBeenCalled();
        });
    });

    describe("monitorLoop", () => {
        it("runs checkBlockEpochs and checkProofEpochs in loop", async () => {
            vi.mocked(BlockEpochModel.find).mockResolvedValue([]);
            vi.mocked(ProofEpochModel.find).mockResolvedValue([]);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startMonitor()).rejects.toThrow("Test iteration limit reached");

            expect(BlockEpochModel.find).toHaveBeenCalled();
            expect(ProofEpochModel.find).toHaveBeenCalled();
            expect(functions.sleep).toHaveBeenCalledWith(MONITOR_INTERVAL_MS);
        });

        it("logs when epochs are marked as failed", async () => {
            const mockBlockEpochs = [
                {
                    height: 8,
                    failCount: MAX_FAIL_COUNT + 1,
                    epochStatus: "processing",
                },
            ];
            const mockProofEpochs = [
                {
                    height: 8,
                    failCount: MAX_FAIL_COUNT + 1,
                    status: ["waiting"],
                    kind: "blockProof",
                },
            ];

            vi.mocked(BlockEpochModel.find).mockResolvedValue(mockBlockEpochs as any);
            vi.mocked(ProofEpochModel.find).mockResolvedValue(mockProofEpochs as any);
            vi.mocked(BlockEpochModel.updateOne).mockResolvedValue({} as any);
            vi.mocked(ProofEpochModel.updateOne).mockResolvedValue({} as any);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startMonitor()).rejects.toThrow("Test iteration limit reached");

            const logger = await import("../../logger.js");
            expect(logger.default.info).toHaveBeenCalledWith(
                "Monitor check completed",
                expect.objectContaining({
                    failedBlockEpochs: 1,
                    failedProofEpochs: 1,
                    event: "monitor_check",
                }),
            );
        });

        it("handles errors gracefully and continues loop", async () => {
            vi.mocked(BlockEpochModel.find)
                .mockRejectedValueOnce(new Error("DB error"))
                .mockResolvedValue([]);
            vi.mocked(ProofEpochModel.find).mockResolvedValue([]);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 2) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startMonitor()).rejects.toThrow("Test iteration limit reached");

            expect(BlockEpochModel.find).toHaveBeenCalledTimes(3);
            const logger = await import("../../logger.js");
            expect(logger.default.error).toHaveBeenCalled();
        });
    });

    describe("startMonitor", () => {
        it("logs start information", async () => {
            vi.mocked(BlockEpochModel.find).mockResolvedValue([]);
            vi.mocked(ProofEpochModel.find).mockResolvedValue([]);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startMonitor()).rejects.toThrow("Test iteration limit reached");

            const logger = await import("../../logger.js");
            expect(logger.default.info).toHaveBeenCalledWith(
                "Starting monitor",
                expect.objectContaining({
                    maxFailCount: MAX_FAIL_COUNT,
                    intervalMs: MONITOR_INTERVAL_MS,
                    event: "monitor_start",
                }),
            );
        });
    });
});
