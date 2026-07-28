import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Types } from "mongoose";
import {
    getBlockEpoch,
    storeBlockInBlockEpoch,
    updateBlockStatusInEpoch,
    deleteBlockEpoch,
    incrementBlockEpochFailCount,
    BlockEpochModel,
} from "../models/BlockEpoch.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
} from "../../config/constants.js";

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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("getBlockEpoch finds epoch by height", async () => {
        const mockEpoch = { height: 16 } as any;
        vi.spyOn(BlockEpochModel, "findOne").mockResolvedValue(mockEpoch);

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
        vi.spyOn(BlockEpochModel, "updateOne").mockResolvedValue({} as any);
        vi.spyOn(BlockEpochModel, "findOneAndUpdate").mockResolvedValue({
            height: 10,
        } as any);

        const result = await storeBlockInBlockEpoch(height, blockId, 2);

        // epochs start at EPOCH_START_HEIGHT (2): [2..9], [10..17], ...
        const expectedEpochHeight =
            EPOCH_START_HEIGHT +
            Math.floor((height - EPOCH_START_HEIGHT) / BLOCK_EPOCH_SIZE) *
                BLOCK_EPOCH_SIZE;
        expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
            { height: expectedEpochHeight },
            {
                $setOnInsert: expect.objectContaining({
                    height: expectedEpochHeight,
                    blocks: Array(BLOCK_EPOCH_SIZE).fill(null),
                    status: Array(BLOCK_EPOCH_SIZE).fill("waiting"),
                    failCount: 0,
                }),
            },
            { upsert: true },
        );
        expect(BlockEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: expectedEpochHeight },
            { $set: { [`blocks.2`]: blockId } },
            { new: true },
        );
        expect(result).toEqual({ height: 10 });
    });

    it("updateBlockStatusInEpoch updates status at given index", async () => {
        vi.spyOn(BlockEpochModel, "findOneAndUpdate").mockResolvedValue({} as any);

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
        vi.spyOn(BlockEpochModel, "deleteOne").mockResolvedValue({} as any);

        await deleteBlockEpoch(8);

        expect(BlockEpochModel.deleteOne).toHaveBeenCalledWith({ height: 8 });
    });

    it("incrementBlockEpochFailCount increments failCount", async () => {
        vi.spyOn(BlockEpochModel, "updateOne").mockResolvedValue({} as any);

        await incrementBlockEpochFailCount(8);

        expect(BlockEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 8 },
            { $inc: { failCount: 1 } },
        );
    });
});
