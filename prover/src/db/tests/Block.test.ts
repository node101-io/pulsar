import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    storeBlock,
    getBlock,
    fetchBlockRange,
    fetchAnchorBlock,
    fetchLastStoredBlock,
    BlockModel,
} from "../models/Block.js";
import {
    ANCHOR_BLOCK_HEIGHT,
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

describe("db block utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("storeBlock upserts block with waiting status on insert", async () => {
        vi.spyOn(BlockModel, "findOneAndUpdate").mockResolvedValue({} as any);

        const validators = [
            { addr: "v1", power: "1" },
            { addr: "v2", power: "2" },
        ];
        const block = {
            height: 10,
            stateRoot: "root",
            validators,
            validatorListHash: "hash",
            actionsReducedRoot: "0",
            voteExt: [],
        } as any;

        await storeBlock(block);

        expect(BlockModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: 10 },
            expect.objectContaining({
                $set: {
                    stateRoot: "root",
                    validators,
                    validatorListHash: "hash",
                    actionsReducedRoot: "0",
                    voteExt: [],
                },
                $setOnInsert: { status: "waiting" },
            }),
            { upsert: true, new: true },
        );
    });

    it("getBlock finds block by height", async () => {
        const mockBlock = { height: 5 } as any;
        vi.spyOn(BlockModel, "findOne").mockResolvedValue(mockBlock);

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
        vi.spyOn(BlockModel, "find").mockReturnValue({ sort: sortMock } as any);

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
        vi.spyOn(BlockModel, "find").mockReturnValue({ sort: sortMock } as any);

        const result = await fetchBlockRange(-1, 1);

        expect(result.length).toBe(3);
        expect(result[0]).toEqual(mockBlocks[0]);
        expect(result[1]).toEqual(mockBlocks[0]);
        expect(result[2]).toEqual(mockBlocks[1]);
    });

    // These pin the contract's initial state. The bug they guard against does
    // not surface here — it surfaces minutes later, on-chain, as an account
    // precondition failure that names no cause.
    describe("fetchAnchorBlock", () => {
        const anchorDoc = {
            height: ANCHOR_BLOCK_HEIGHT,
            stateRoot: "111",
            validatorListHash: "222",
        };

        it("reads the block the first proof starts from, not the genesis record", async () => {
            vi.spyOn(BlockModel, "findOne").mockResolvedValue(anchorDoc as any);

            await fetchAnchorBlock();

            expect(BlockModel.findOne).toHaveBeenCalledWith({
                height: ANCHOR_BLOCK_HEIGHT,
            });
            // createProof(EPOCH_START_HEIGHT) reads from one block below it —
            // that block, and only that block, is a valid anchor.
            expect(ANCHOR_BLOCK_HEIGHT).toBe(EPOCH_START_HEIGHT - 1);
        });

        it("returns all three fields from that one record", async () => {
            vi.spyOn(BlockModel, "findOne").mockResolvedValue(anchorDoc as any);

            await expect(fetchAnchorBlock()).resolves.toEqual({
                validatorListHash: "222",
                stateRoot: "111",
                height: ANCHOR_BLOCK_HEIGHT,
            });
        });

        it("throws instead of defaulting when the anchor is missing", async () => {
            vi.spyOn(BlockModel, "findOne").mockResolvedValue(null as any);

            await expect(fetchAnchorBlock()).rejects.toThrow(
                /Anchor block .* is missing or incomplete/,
            );
        });

        it("throws when the anchor record is incomplete", async () => {
            vi.spyOn(BlockModel, "findOne").mockResolvedValue({
                height: ANCHOR_BLOCK_HEIGHT,
                stateRoot: "111",
            } as any);

            await expect(fetchAnchorBlock()).rejects.toThrow(
                /missing or incomplete/,
            );
        });
    });

    it("fetchLastStoredBlock returns null and logs warn when no block", async () => {
        vi.spyOn(BlockModel, "findOne").mockReturnValue({
            sort: vi.fn().mockResolvedValue(null),
        } as any);

        const result = await fetchLastStoredBlock();

        expect(result).toBeNull();
        const logger = await import("../../common/logger.js");
        expect(logger.default.warn).toHaveBeenCalledWith(
            "No blocks found in the database.",
        );
    });

    it("fetchLastStoredBlock returns last block and logs info", async () => {
        const mockBlock = { height: 42 } as any;
        vi.spyOn(BlockModel, "findOne").mockReturnValue({
            sort: vi.fn().mockResolvedValue(mockBlock),
        } as any);

        const result = await fetchLastStoredBlock();

        expect(result).toBe(mockBlock);
        const logger = await import("../../common/logger.js");
        expect(logger.default.info).toHaveBeenCalledWith(
            "Fetched last stored block at height 42.",
        );
    });
});
