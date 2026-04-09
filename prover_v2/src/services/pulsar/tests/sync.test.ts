import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startPulsarSync } from "../sync.js";
import * as client from "../client.js";
import * as db from "../../../db/index.js";
import * as sleepModule from "../../../common/sleep.js";
import { BlockData } from "../../../common/types.js";

vi.mock("../client.js");
vi.mock("../../../db/index.js");
vi.mock("../../../common/sleep.js");
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

        vi.mocked(client.createClient).mockImplementation(async (serviceName) => {
            if (serviceName.includes("tendermint")) {
                return mockTmClient;
            }
            return mockMkClient;
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
        expect(client.createClient).toHaveBeenCalledTimes(2);
        expect(client.getLatestHeight).toHaveBeenCalledWith(mockTmClient);
    });

    it("processes new blocks when latestHeight > currentHeight", async () => {
        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue({ height: 5 } as any);

        const mockBlockData: BlockData = {
            height: 6,
            stateRoot: "0x123",
            validators: ["B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb"],
            voteExt: [],
        };

        vi.mocked(client.getBlockData).mockResolvedValue(mockBlockData);
        vi.mocked(client.storePulsarBlock).mockResolvedValue();
        vi.mocked(client.getLatestHeight).mockResolvedValue(7);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.getBlockData).toHaveBeenCalledTimes(2);
        expect(client.storePulsarBlock).toHaveBeenCalledTimes(2);
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

    it("uses default rpcAddress when PULSAR_GRPC_ENDPOINT not set", async () => {
        const originalEnv = process.env.PULSAR_GRPC_ENDPOINT;
        delete process.env.PULSAR_GRPC_ENDPOINT;

        vi.mocked(db.fetchLastStoredBlock).mockResolvedValue(null);
        vi.mocked(client.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(client.createClient).toHaveBeenCalledWith(
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
        vi.mocked(client.getLatestHeight).mockResolvedValue(0);

        await expect(startPulsarSync()).rejects.toThrow("Test iteration limit reached");

        expect(db.fetchLastStoredBlock).toHaveBeenCalled();
        expect(client.getLatestHeight).toHaveBeenCalled();
    });
});
