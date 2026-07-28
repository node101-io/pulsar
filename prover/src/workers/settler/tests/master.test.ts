import { describe, it, expect, vi, beforeEach } from "vitest";
import { MASTER_SLEEP_INTERVAL_MS } from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
        updateMany: vi.fn(),
        exists: vi.fn(),
    },
    incrementProofEpochFailCount: vi.fn(),
}));

vi.mock("../../queue.js", () => ({
    settlerQ: {
        add: vi.fn(),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    },
}));

vi.mock("../redis.js", () => ({
    connection: {},
}));

vi.mock("../worker.js", () => ({
    worker: vi.fn(),
}));

vi.mock("o1js", () => ({
    PublicKey: {
        fromBase58: vi.fn(() => ({})),
    },
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({ network: "lightnet" })),
    getContractBlockHeight: vi.fn(async () => 0),
}));

vi.mock("../../../common/sleep.js", () => ({
    sleep: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../../db/index.js";
import { settlerQ } from "../../queue.js";
import { sleep } from "../../../common/sleep.js";
import { getContractBlockHeight } from "../../../services/mina/client.js";
import { SettlerMaster } from "../master.js";

describe("settler master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
        vi.mocked(settlerQ.getJobCounts).mockResolvedValue({
            waiting: 0,
            active: 0,
            delayed: 0,
        } as any);
        vi.mocked(ProofEpochModel.updateMany).mockResolvedValue({
            modifiedCount: 0,
        } as any);
    });

    it("queues settler job when epoch in settlement state found", async () => {
        vi.mocked(ProofEpochModel.exists).mockResolvedValue({ _id: 1 } as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            kind: "settlement",
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).toHaveBeenCalledWith("settler", {
            height: 20,
        });
        expect(sleep).not.toHaveBeenCalled();
    });

    // Settlement is strictly sequential: an epoch at height H starts from block
    // H-1, and the contract only accepts a proof starting at its current
    // blockHeight. Claiming any other epoch produces a transaction the contract
    // must reject, after a full proving cycle.
    it("claims only the epoch at contractBlockHeight + 1", async () => {
        vi.mocked(ProofEpochModel.exists).mockResolvedValue({ _id: 1 } as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(33);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 34,
            kind: "settlement",
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        const [filter] = vi.mocked(ProofEpochModel.findOneAndUpdate).mock
            .calls[0];
        expect(filter).toMatchObject({ height: { $eq: 34 } });
    });

    it("sleeps when the next epoch in sequence is not ready", async () => {
        vi.mocked(ProofEpochModel.exists).mockResolvedValue({ _id: 1 } as any);
        vi.mocked(getContractBlockHeight).mockResolvedValue(33);
        // A later epoch is settlement-ready, but 34 is not — nothing is claimed.
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(
            null as any,
        );

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("sleeps when no epoch in settlement state", async () => {
        vi.mocked(ProofEpochModel.exists).mockResolvedValue(null as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("waits for the in-flight tx instead of claiming a new epoch", async () => {
        vi.mocked(settlerQ.getJobCounts).mockResolvedValue({
            waiting: 1,
            active: 0,
            delayed: 0,
        } as any);
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 20,
            kind: "txSending",
        } as any);

        const m = new SettlerMaster() as any;
        await m.handleTask();

        expect(ProofEpochModel.updateMany).not.toHaveBeenCalled();
        expect(settlerQ.add).not.toHaveBeenCalled();
        expect(sleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("rolls back kind to settlement when queue add fails", async () => {
        vi.mocked(ProofEpochModel.exists).mockResolvedValue({ _id: 1 } as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: 20,
            kind: "settlement",
        } as any);
        vi.mocked(settlerQ.add).mockRejectedValueOnce(new Error("queue error"));

        const m = new SettlerMaster() as any;
        await expect(m.handleTask()).rejects.toThrow("queue error");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: 20, kind: "txSending" },
            { $set: { kind: "settlement" } },
        );
    });
});
