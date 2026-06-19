import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
    initMinaClientContext: vi.fn(),
    getCurrentMinaBlockHeight: vi.fn(),
    getContractBlockHeight: vi.fn(),
}));

vi.mock("../../../db/index.js", () => ({
    saveMinaState: vi.fn(),
}));

vi.mock("../../../common/sleep.js", () => ({
    sleep: vi.fn(),
}));

vi.mock("../../../config/constants.js", () => ({
    POLL_INTERVAL_MS: 5000,
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn(() => ({ toBase58: () => "B62qtest" })),
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

import { startMinaSync } from "../sync.js";
import {
    initMinaClientContext,
    getCurrentMinaBlockHeight,
    getContractBlockHeight,
} from "../client.js";
import { saveMinaState } from "../../../db/index.js";
import { sleep } from "../../../common/sleep.js";

const mockCtx = {
    network: "lightnet",
    watchedAddress: { toBase58: () => "B62qtest" },
};

describe("mina sync - startMinaSync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it("throws when CONTRACT_ADDRESS is not set", async () => {
        delete process.env.CONTRACT_ADDRESS;

        await expect(startMinaSync()).rejects.toThrow(
            "CONTRACT_ADDRESS is not set",
        );
    });

    it("initializes context and performs initial sync on startup", async () => {
        vi.mocked(initMinaClientContext).mockResolvedValue(mockCtx as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(400);
        vi.mocked(getCurrentMinaBlockHeight).mockResolvedValue(100);
        vi.mocked(saveMinaState).mockResolvedValue(undefined);
        vi.mocked(sleep).mockRejectedValueOnce(new Error("stop"));

        await expect(startMinaSync()).rejects.toThrow("stop");

        expect(initMinaClientContext).toHaveBeenCalledOnce();
        expect(getContractBlockHeight).toHaveBeenCalledWith(mockCtx);
        expect(saveMinaState).toHaveBeenCalledWith(400);
    });

    it("syncs contract state when new Mina block is detected", async () => {
        vi.mocked(initMinaClientContext).mockResolvedValue(mockCtx as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(400);
        vi.mocked(getCurrentMinaBlockHeight)
            .mockResolvedValueOnce(100) // lastSeenMinaHeight init
            .mockResolvedValueOnce(101); // new block in loop
        vi.mocked(saveMinaState).mockResolvedValue(undefined);
        vi.mocked(sleep).mockRejectedValueOnce(new Error("stop"));

        await expect(startMinaSync()).rejects.toThrow("stop");

        // called twice: initial sync + new block in loop
        expect(saveMinaState).toHaveBeenCalledTimes(2);
        expect(getContractBlockHeight).toHaveBeenCalledTimes(2);
    });

    it("does not sync when Mina block height has not changed", async () => {
        vi.mocked(initMinaClientContext).mockResolvedValue(mockCtx as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(400);
        vi.mocked(getCurrentMinaBlockHeight).mockResolvedValue(100);
        vi.mocked(saveMinaState).mockResolvedValue(undefined);
        vi.mocked(sleep).mockRejectedValueOnce(new Error("stop"));

        await expect(startMinaSync()).rejects.toThrow("stop");

        // only initial sync
        expect(saveMinaState).toHaveBeenCalledTimes(1);
    });

    it("logs error and continues loop after iteration error", async () => {
        vi.mocked(initMinaClientContext).mockResolvedValue(mockCtx as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(400);
        vi.mocked(getCurrentMinaBlockHeight)
            .mockResolvedValueOnce(100)
            .mockRejectedValueOnce(new Error("network error"))
            .mockResolvedValueOnce(100);
        vi.mocked(saveMinaState).mockResolvedValue(undefined);
        vi.mocked(sleep)
            .mockResolvedValueOnce(undefined) // first iteration completes
            .mockRejectedValueOnce(new Error("stop")); // exit on second

        await expect(startMinaSync()).rejects.toThrow("stop");

        const logger = await import("../../../common/logger.js");
        expect(logger.default.error).toHaveBeenCalled();
    });

    it("sleeps with POLL_INTERVAL_MS between iterations", async () => {
        vi.mocked(initMinaClientContext).mockResolvedValue(mockCtx as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(400);
        vi.mocked(getCurrentMinaBlockHeight).mockResolvedValue(100);
        vi.mocked(saveMinaState).mockResolvedValue(undefined);
        vi.mocked(sleep).mockRejectedValueOnce(new Error("stop"));

        await expect(startMinaSync()).rejects.toThrow("stop");

        expect(sleep).toHaveBeenCalledWith(5000);
    });
});
