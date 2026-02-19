import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startPulsarSync } from "./sync.js";
import * as utils from "./utils.js";
import * as db from "../db/index.js";
import * as functions from "../utils/functions.js";
import { BlockData } from "../utils/interfaces.js";

vi.mock("./utils.js");
vi.mock("../db/index.js");
vi.mock("../utils/functions.js");
vi.mock("../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("pulsar sync", () => {
    let mockTmClient: any;
    let mockMkClient: any;
    let sleepCallCount: number;

    beforeEach(() => {
        vi.clearAllMocks();
        sleepCallCount = 0;

        mockTmClient = {
            GetLatestBlock: vi.fn(),
            GetBlockByHeight: vi.fn(),
            GetValidatorSetByHeight: vi.fn(),
        };
        mockMkClient = {
            KeyStore: vi.fn(),
            VoteExtByHeight: vi.fn(),
            GetMinaPubkey: vi.fn(),
        };

        vi.mocked(utils.createClient).mockImplementation(async (serviceName) => {
            if (serviceName.includes("tendermint")) {
                return mockTmClient;
            }
            return mockMkClient;
        });

        vi.mocked(functions.sleep).mockImplementation(async () => {
            sleepCallCount++;
            if (sleepCallCount > 1) {
                throw new Error("Test iteration limit reached");
            }
            return Promise.resolve();
        });
    });

    it("starts sync from last stored block height", async () => {
        const mockLastBlock = { height: 10 };
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(mockLastBlock as any);
        vi.mocked(utils.getLatestHeight).mockResolvedValue(10);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(db.fetchLastStoredBlock).toHaveBeenCalled();
        expect(utils.createClient).toHaveBeenCalledTimes(2);
        expect(utils.getLatestHeight).toHaveBeenCalledWith(mockTmClient);
    });

    it("processes new blocks when latestHeight > currentHeight", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 5 } as any);

        const mockBlockData: BlockData = {
            height: 6,
            stateRoot: "0x123",
            validators: ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
            voteExt: [],
        };

        vi.mocked(utils.getBlockData).mockResolvedValue(mockBlockData);
        vi.mocked(utils.storePulsarBlock).mockResolvedValue();
        vi.mocked(utils.getLatestHeight).mockResolvedValue(7);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(utils.getBlockData).toHaveBeenCalledTimes(2);
        expect(utils.storePulsarBlock).toHaveBeenCalledTimes(2);
    });

    it("handles errors gracefully and continues loop", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 0 } as any);
        vi.mocked(utils.getLatestHeight)
            .mockRejectedValueOnce(new Error("gRPC error"))
            .mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(utils.getLatestHeight).toHaveBeenCalledTimes(2);
        expect(functions.sleep).toHaveBeenCalled();
    });

    it("uses default rpcAddress when PULSAR_GRPC_ENDPOINT not set", async () => {
        const originalEnv = process.env.PULSAR_GRPC_ENDPOINT;
        delete process.env.PULSAR_GRPC_ENDPOINT;

        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(null);
        vi.mocked(utils.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(utils.createClient).toHaveBeenCalledWith(
            expect.any(String),
            "localhost:50051",
            expect.any(Object),
        );

        if (originalEnv) {
            process.env.PULSAR_GRPC_ENDPOINT = originalEnv;
        }
    });

    it("starts from height 0 when no last stored block", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(null);
        vi.mocked(utils.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(db.fetchLastStoredBlock).toHaveBeenCalled();
        expect(utils.getLatestHeight).toHaveBeenCalled();
    });
});
