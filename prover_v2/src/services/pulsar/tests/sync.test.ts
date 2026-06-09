import { describe, it, expect, vi, beforeEach } from "vitest";
import { startPulsarSync } from "../sync.js";
import * as client from "../client.js";
import * as db from "../../../db/index.js";
import * as sleepModule from "../../../common/sleep.js";
import { BlockData } from "../../../common/types.js";

vi.mock("../client.js");
vi.mock("../../../common/sleep.js");
vi.mock("../../../db/index.js", () => ({
    fetchLastStoredBlock: vi.fn(),
    BlockModel: {
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockResolvedValue([]) }),
        updateOne: vi.fn().mockResolvedValue({}),
    },
    BlockEpochModel: {
        updateOne: vi.fn().mockResolvedValue({}),
    },
}));
vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("pulsar sync", () => {
    let mockTmClient: any;
    let mockVpClient: any;
    let mockKrClient: any;
    let mockAbciClient: any;
    let sleepCallCount: number;

    beforeEach(() => {
        vi.clearAllMocks();
        sleepCallCount = 0;

        mockTmClient = {
            GetLatestBlock: vi.fn(),
            GetBlockByHeight: vi.fn(),
            GetValidatorSetByHeight: vi.fn(),
        };
        mockVpClient = {
            VoteExtensions: vi.fn(),
        };
        mockKrClient = {
            GetValidatorMinaPubKey: vi.fn(),
        };
        mockAbciClient = {
            VoteExtBodyByHeight: vi.fn(),
        };

        vi.mocked(client.createClient).mockImplementation(async (serviceName) => {
            if (serviceName.includes("tendermint")) return mockTmClient;
            if (serviceName.includes("votepersistence")) return mockVpClient;
            if (serviceName.includes("abci")) return mockAbciClient;
            return mockKrClient;
        });

        vi.mocked(sleepModule.sleep).mockImplementation(async () => {
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
        vi.mocked(client.getLatestHeight).mockResolvedValue(10);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(db.fetchLastStoredBlock).toHaveBeenCalled();
        expect(client.createClient).toHaveBeenCalledTimes(4);
        expect(client.getLatestHeight).toHaveBeenCalledWith(mockTmClient);
    });

    it("processes new blocks up to latestHeight - 2", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 5 } as any);

        const mockBlockData: BlockData = {
            height: 6,
            stateRoot: "0x123",
            validators: ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
            actionsReducedRoot: "0",
            voteExt: [],
        };

        vi.mocked(client.getBlockData).mockResolvedValue(mockBlockData);
        vi.mocked(client.storePulsarBlock).mockResolvedValue();
        // latestHeight=9 → processUpTo=7 → h=6,7 (2 blocks)
        vi.mocked(client.getLatestHeight).mockResolvedValue(9);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.getBlockData).toHaveBeenCalledTimes(2);
        expect(client.storePulsarBlock).toHaveBeenCalledTimes(2);
    });

    it("does not process blocks when latestHeight - 2 <= currentHeight", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 10 } as any);
        // latestHeight=12 → processUpTo=10, not > currentHeight(10) → no blocks
        vi.mocked(client.getLatestHeight).mockResolvedValue(12);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.getBlockData).not.toHaveBeenCalled();
        expect(client.storePulsarBlock).not.toHaveBeenCalled();
    });

    it("passes all 4 clients to getBlockData", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 5 } as any);
        vi.mocked(client.getLatestHeight).mockResolvedValue(8);
        vi.mocked(client.getBlockData).mockResolvedValue({
            height: 6,
            stateRoot: "0x1",
            validators: [],
            actionsReducedRoot: "0",
            voteExt: [],
        });
        vi.mocked(client.storePulsarBlock).mockResolvedValue();

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.getBlockData).toHaveBeenCalledWith(
            mockTmClient,
            mockVpClient,
            mockKrClient,
            mockAbciClient,
            expect.any(Number),
        );
    });

    it("handles errors gracefully and continues loop", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 0 } as any);
        vi.mocked(client.getLatestHeight)
            .mockRejectedValueOnce(new Error("gRPC error"))
            .mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.getLatestHeight).toHaveBeenCalledTimes(2);
        expect(sleepModule.sleep).toHaveBeenCalled();
    });

    it("uses default rpcAddress localhost:9090 when PULSAR_GRPC_ENDPOINT not set", async () => {
        const originalEnv = process.env.PULSAR_GRPC_ENDPOINT;
        delete process.env.PULSAR_GRPC_ENDPOINT;

        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(null);
        vi.mocked(client.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.createClient).toHaveBeenCalledWith(
            expect.any(String),
            "localhost:9090",
            expect.any(Object),
        );

        if (originalEnv) {
            process.env.PULSAR_GRPC_ENDPOINT = originalEnv;
        }
    });

    it("starts from height 0 when no last stored block", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(null);
        vi.mocked(client.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(db.fetchLastStoredBlock).toHaveBeenCalled();
        expect(client.getLatestHeight).toHaveBeenCalled();
    });
});
