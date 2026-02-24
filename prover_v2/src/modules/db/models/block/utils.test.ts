import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    storeBlock,
    getBlock,
    fetchBlockRange,
    fetchLastStoredBlock,
    seedInitialBlocks,
} from "./utils.js";
import { BlockModel } from "./Block.js";

vi.mock("./Block.js");
vi.mock("../../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("db block utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("storeBlock upserts block with timeout and waiting status on insert", async () => {
        vi.mocked(BlockModel.updateOne).mockResolvedValue({} as any);

        const block = {
            height: 10,
            stateRoot: "root",
            validators: ["v1", "v2"],
            validatorListHash: "hash",
            voteExt: [],
        } as any;

        await storeBlock(block);

        expect(BlockModel.updateOne).toHaveBeenCalledWith(
            { height: 10 },
            expect.objectContaining({
                $set: {
                    stateRoot: "root",
                    validators: ["v1", "v2"],
                    validatorListHash: "hash",
                    voteExt: [],
                },
                $setOnInsert: expect.objectContaining({
                    status: "waiting",
                    timeoutAt: expect.any(Date),
                }),
            }),
            { upsert: true },
        );
    });

    it("getBlock finds block by height", async () => {
        const mockBlock = { height: 5 } as any;
        vi.mocked(BlockModel.findOne).mockResolvedValue(mockBlock);

        const result = await getBlock(5);

        expect(BlockModel.findOne).toHaveBeenCalledWith({ height: 5 });
        expect(result).toBe(mockBlock);
    });

    it("fetchBlockRange queries by height range and sorts ascending", async () => {
        const mockBlocks = [
            { height: 1 },
            { height: 2 },
            { height: 3 },
        ] as any[];
        const sortMock = vi.fn().mockResolvedValue(mockBlocks);
        vi.mocked(BlockModel.find).mockReturnValue({ sort: sortMock } as any);

        const result = await fetchBlockRange(1, 3);

        expect(BlockModel.find).toHaveBeenCalledWith({
            height: { $gte: 1, $lte: 3 },
        });
        expect(sortMock).toHaveBeenCalledWith({ height: 1 });
        expect(result).toEqual(mockBlocks);
    });

    it("fetchBlockRange duplicates first block when rangeLow < 0", async () => {
        const mockBlocks = [{ height: 0 }, { height: 1 }] as any[];
        const sortMock = vi.fn().mockResolvedValue([...mockBlocks]);
        vi.mocked(BlockModel.find).mockReturnValue({ sort: sortMock } as any);

        const result = await fetchBlockRange(-1, 1);

        expect(result.length).toBe(3);
        expect(result[0]).toEqual(mockBlocks[0]);
        expect(result[1]).toEqual(mockBlocks[0]);
        expect(result[2]).toEqual(mockBlocks[1]);
    });

    it("fetchLastStoredBlock returns null and logs warn when no block", async () => {
        vi.mocked(BlockModel.findOne).mockReturnValue({
            sort: vi.fn().mockResolvedValue(null),
        } as any);

        const result = await fetchLastStoredBlock();

        expect(result).toBeNull();
        const logger = await import("../../../../logger.js");
        expect(logger.default.warn).toHaveBeenCalledWith(
            "No blocks found in the database.",
        );
    });

    it("fetchLastStoredBlock returns last block and logs info", async () => {
        const mockBlock = { height: 42 } as any;
        vi.mocked(BlockModel.findOne).mockReturnValue({
            sort: vi.fn().mockResolvedValue(mockBlock),
        } as any);

        const result = await fetchLastStoredBlock();

        expect(result).toBe(mockBlock);
        const logger = await import("../../../../logger.js");
        expect(logger.default.info).toHaveBeenCalledWith(
            "Fetched last stored block at height 42.",
        );
    });

    it("seedInitialBlocks returns early when genesis block exists", async () => {
        vi.mocked(BlockModel.exists).mockResolvedValue(true as any);

        await seedInitialBlocks();

        expect(BlockModel.create).not.toHaveBeenCalled();
    });
});

