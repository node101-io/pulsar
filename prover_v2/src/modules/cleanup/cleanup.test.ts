import { describe, it, expect, vi, beforeEach } from "vitest";
import { startCleanup, runCleanup } from "./cleanup.js";
import { BlockEpochModel } from "../db/models/blockEpoch/BlockEpoch.js";
import { ProofEpochModel } from "../db/models/proofEpoch/ProofEpoch.js";
import { BlockModel } from "../db/models/block/Block.js";
import { ProofModel } from "../db/models/proof/Proof.js";
import { CLEANUP_AGE_MS, CLEANUP_INTERVAL_MS } from "../utils/constants.js";
import * as functions from "../utils/functions.js";

vi.mock("../db/models/blockEpoch/BlockEpoch.js");
vi.mock("../db/models/proofEpoch/ProofEpoch.js");
vi.mock("../db/models/block/Block.js");
vi.mock("../db/models/proof/Proof.js");
vi.mock("../utils/functions.js");
vi.mock("../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("cleanup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(functions.sleep).mockResolvedValue(undefined);
    });

    describe("runCleanup", () => {
        it("deletes old documents from all models with updatedAt < cutoff", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 2,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 1,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 3,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            const total = await runCleanup();

            const expectedFilter = {
                updatedAt: { $lt: expect.any(Date) },
            };
            expect(BlockEpochModel.deleteMany).toHaveBeenCalledWith(
                expectedFilter,
            );
            expect(ProofEpochModel.deleteMany).toHaveBeenCalledWith(
                expectedFilter,
            );
            expect(BlockModel.deleteMany).toHaveBeenCalledWith(expectedFilter);
            expect(ProofModel.deleteMany).toHaveBeenCalledWith(expectedFilter);

            expect(total).toBe(6);
        });

        it("uses cutoff date as now minus CLEANUP_AGE_MS", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            const before = Date.now();
            await runCleanup();
            const after = Date.now();

            const call = vi.mocked(BlockEpochModel.deleteMany).mock
                .calls[0][0] as unknown as { updatedAt: { $lt: Date } };
            expect(call).toBeDefined();
            const cutoffTime = call.updatedAt.$lt.getTime();
            // 100ms tolerance for the test to be reliable
            expect(cutoffTime).toBeGreaterThanOrEqual(
                before - CLEANUP_AGE_MS - 100,
            );
            expect(cutoffTime).toBeLessThanOrEqual(
                after - CLEANUP_AGE_MS + 100,
            );
        });

        it("logs per model when deletedCount > 0", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 2,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 1,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            await runCleanup();

            const logger = await import("../../logger.js");
            expect(logger.default.info).toHaveBeenCalledWith(
                "Cleanup: deleted block epochs",
                { count: 2, event: "cleanup_block_epochs" },
            );
            expect(logger.default.info).toHaveBeenCalledWith(
                "Cleanup: deleted blocks",
                { count: 1, event: "cleanup_blocks" },
            );
            expect(logger.default.info).not.toHaveBeenCalledWith(
                "Cleanup: deleted proof epochs",
                expect.any(Object),
            );
            expect(logger.default.info).not.toHaveBeenCalledWith(
                "Cleanup: deleted proofs",
                expect.any(Object),
            );
        });

        it("logs cleanup_completed when totalDeleted > 0", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 1,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            await runCleanup();

            const logger = await import("../../logger.js");
            expect(logger.default.info).toHaveBeenCalledWith(
                "Cleanup completed",
                { totalDeleted: 1, event: "cleanup_completed" },
            );
        });

        it("does not log cleanup_completed when nothing deleted", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            await runCleanup();

            const logger = await import("../../logger.js");
            const cleanupCompletedCalls = vi
                .mocked(logger.default.info)
                .mock.calls.filter((c) => c[0] === "Cleanup completed");
            expect(cleanupCompletedCalls).toHaveLength(0);
        });

        it("returns 0 when no documents deleted", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            const total = await runCleanup();

            expect(total).toBe(0);
        });
    });

    describe("cleanupLoop", () => {
        it("runs runCleanup then sleep in loop", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startCleanup()).rejects.toThrow(
                "Test iteration limit reached",
            );

            expect(BlockEpochModel.deleteMany).toHaveBeenCalledTimes(2);
            expect(functions.sleep).toHaveBeenCalledWith(CLEANUP_INTERVAL_MS);
        });

        it("on runCleanup error logs and continues loop", async () => {
            vi.mocked(BlockEpochModel.deleteMany)
                .mockRejectedValueOnce(new Error("DB error"))
                .mockResolvedValue({
                    deletedCount: 0,
                    acknowledged: true,
                } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 2) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startCleanup()).rejects.toThrow(
                "Test iteration limit reached",
            );

            const logger = await import("../../logger.js");
            expect(logger.default.error).toHaveBeenCalled();
            expect(BlockEpochModel.deleteMany).toHaveBeenCalledTimes(3);
        });
    });

    describe("startCleanup", () => {
        it("logs start with cleanupAgeMs and intervalMs", async () => {
            vi.mocked(BlockEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofEpochModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(BlockModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);
            vi.mocked(ProofModel.deleteMany).mockResolvedValue({
                deletedCount: 0,
                acknowledged: true,
            } as any);

            let callCount = 0;
            vi.mocked(functions.sleep).mockImplementation(async () => {
                callCount++;
                if (callCount > 1) {
                    throw new Error("Test iteration limit reached");
                }
                return Promise.resolve();
            });

            await expect(startCleanup()).rejects.toThrow(
                "Test iteration limit reached",
            );

            const logger = await import("../../logger.js");
            expect(logger.default.info).toHaveBeenCalledWith(
                "Starting cleanup",
                expect.objectContaining({
                    cleanupAgeMs: CLEANUP_AGE_MS,
                    intervalMs: CLEANUP_INTERVAL_MS,
                    event: "cleanup_start",
                }),
            );
        });
    });
});
