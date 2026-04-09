import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import {
    getBlockEpoch,
    storeBlockInBlockEpoch,
    updateBlockStatusInEpoch,
    deleteBlockEpoch,
    incrementBlockEpochFailCount,
} from "../models/BlockEpoch.js";
import { BlockEpochModel } from "../models/BlockEpoch.js";
import { BLOCK_EPOCH_SIZE } from "../../config/constants.js";

vi.mock("../models/BlockEpoch.js");
vi.mock("../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("db blockEpoch utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("getBlockEpoch finds epoch by height", async () => {
        const mockEpoch = { height: 16 } as any;
        vi.mocked(BlockEpochModel.findOne).mockResolvedValue(mockEpoch);

        const result = await getBlockEpoch(16);

        expect(BlockEpochModel.findOne).toHaveBeenCalledWith({ height: 16 });
        expect(result).toBe(mockEpoch);
    });

    it("storeBlockInBlockEpoch throws when index is out of range", async () => {
        const height = 10;
        const blockId = new Types.ObjectId();

        await expect(
            storeBlockInBlockEpoch(height, blockId, -1),
        ).rejects.toThrow("Index must be between 0 and");
        await expect(
            storeBlockInBlockEpoch(height, blockId, BLOCK_EPOCH_SIZE),
        ).rejects.toThrow("Index must be between 0 and");
    });

    it("storeBlockInBlockEpoch upserts epoch and stores block at computed epoch height", async () => {
        const height = 10;
        const blockId = new Types.ObjectId();
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 8,
        } as any);

        const result = await storeBlockInBlockEpoch(height, blockId, 2);

        const expectedEpochHeight =
            Math.floor(height / BLOCK_EPOCH_SIZE) * BLOCK_EPOCH_SIZE;
        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: expectedEpochHeight },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                    height: expectedEpochHeight,
                    blocks: Array(BLOCK_EPOCH_SIZE).fill(null),
                    status: Array(BLOCK_EPOCH_SIZE).fill("waiting"),
                    failCount: 0,
                    timeoutAt: expect.any(Date),
                }),
                $set: expect.objectContaining({
                    [`blocks.2`]: blockId,
                }),
            }),
            { upsert: true, new: true },
        );
        expect(result).toEqual({ height: 8 });
    });

    it("updateBlockStatusInEpoch updates status at given index", async () => {
        vi.mocked(BlockEpochModel.findOneAndUpdate).mockResolvedValue({} as any);

        await updateBlockStatusInEpoch(8, 1, "processing");

        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 8 },
            {
                $set: {
                    ["status.1"]: "processing",
                },
            },
        );
    });

    it("updateBlockStatusInEpoch throws when index is out of range", async () => {
        await expect(
            updateBlockStatusInEpoch(8, -1, "processing"),
        ).rejects.toThrow("Index must be between 0 and");
        await expect(
            updateBlockStatusInEpoch(8, BLOCK_EPOCH_SIZE, "processing"),
        ).rejects.toThrow("Index must be between 0 and");
    });

    it("deleteBlockEpoch deletes epoch by height", async () => {
        vi.mocked(BlockEpochModel.deleteOne).mockResolvedValue({} as any);

        await deleteBlockEpoch(8);

        expect(BlockEpochModel.deleteOne).toHaveBeenCalledWith({ height: 8 });
    });

    it("incrementBlockEpochFailCount increments failCount and updates timeoutAt", async () => {
        vi.mocked(BlockEpochModel.updateOne).mockResolvedValue({} as any);

        await incrementBlockEpochFailCount(8);

        const call = vi.mocked(BlockEpochModel.updateOne).mock.calls[0][1] as any;
        expect(call.$inc).toEqual({ failCount: 1 });
        expect(call.$set.timeoutAt).toBeInstanceOf(Date);
    });
});
