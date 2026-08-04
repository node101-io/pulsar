import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    MASTER_SLEEP_INTERVAL_MS,
    MAX_FAIL_COUNT,
} from "../../../config/constants.js";

const {
    mockBridgeStateFindOne,
    mockBridgeStateFindOneAndUpdate,
    mockGetBridgeState,
    mockQueueAdd,
    mockGetJobCounts,
    mockRefreshContractState,
    mockGetActionState,
    mockGetActionStateHistory,
    mockSleep,
    mockLoggerError,
} = vi.hoisted(() => ({
    mockBridgeStateFindOne: vi.fn(),
    mockBridgeStateFindOneAndUpdate: vi.fn(),
    mockGetBridgeState: vi.fn(),
    mockQueueAdd: vi.fn(),
    mockGetJobCounts: vi.fn(),
    mockRefreshContractState: vi.fn(),
    mockGetActionState: vi.fn(),
    mockGetActionStateHistory: vi.fn(),
    mockSleep: vi.fn(),
    mockLoggerError: vi.fn(),
}));

vi.mock("../../../db/models/BridgeState.js", () => ({
    BridgeStateModel: {
        findOne: mockBridgeStateFindOne,
        findOneAndUpdate: mockBridgeStateFindOneAndUpdate,
    },
    getBridgeState: mockGetBridgeState,
}));

vi.mock("../../queue.js", () => ({
    bridgeTxSenderQ: {
        add: mockQueueAdd,
        getJobCounts: mockGetJobCounts,
    },
}));

vi.mock("../../redis.js", () => ({
    connection: {},
}));

vi.mock("../worker.js", () => ({
    worker: vi.fn(),
    ensureCompiled: vi.fn(),
}));

vi.mock("../../../common/sleep.js", () => ({
    sleep: mockSleep,
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({})),
    refreshContractState: mockRefreshContractState,
    getContractActionState: mockGetActionState,
    getActionStateHistory: mockGetActionStateHistory,
}));

vi.mock("bullmq", () => {
    class Queue {
        obliterate = vi.fn();
        close = vi.fn();
    }
    class Worker {}
    return { Queue, Worker };
});

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: mockLoggerError,
        debug: vi.fn(),
    },
}));

import { BridgeTxSenderMaster } from "../master.js";

const PROCESSED = "100"; // contract state[0]
const TIP = "999"; // account actionState[0]

const FAILURE_PIPELINE = [
    {
        $set: {
            txFailCount: { $add: [{ $ifNull: ["$txFailCount", 0] }, 1] },
            txAttemptActive: false,
        },
    },
];

describe("bridge-tx-sender master — scheduling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJobCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0 });
        mockRefreshContractState.mockResolvedValue(undefined);
        mockGetActionState.mockReturnValue(PROCESSED);
        mockGetActionStateHistory.mockReturnValue([TIP, "888", "777", "666", "555"]);
        mockGetBridgeState.mockResolvedValue({
            txFailCount: 0,
            txAttemptActionState: undefined,
        });
        mockQueueAdd.mockResolvedValue({});
        mockSleep.mockResolvedValue(undefined);
    });

    // The pending-work signal is the gap between the contract's processed
    // pointer (state[0]) and the account's live action queue tip — no DB rows,
    // no height arithmetic.
    it("queues a reduce job when the contract lags the action queue tip", async () => {
        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockQueueAdd).toHaveBeenCalledWith("bridge-tx-sender", {
            fromActionState: PROCESSED,
        });
        expect(mockSleep).not.toHaveBeenCalled();
    });

    it("sleeps when the contract is fully reduced (pointer equals tip)", async () => {
        mockGetActionState.mockReturnValue(TIP);

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("does not touch the chain while a job is queued or active", async () => {
        mockGetJobCounts.mockResolvedValue({ waiting: 0, active: 1, delayed: 0 });

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockRefreshContractState).not.toHaveBeenCalled();
        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    it("sleeps without queueing when the contract state refresh fails", async () => {
        mockRefreshContractState.mockRejectedValue(new Error("node down"));

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });

    // Durable circuit breaker: state lives in Mongo, so it survives restarts —
    // and re-evaluating it every tick means an operator fix (resetting
    // txFailCount) or the front advancing recovers the master automatically.
    it("halts (long idle + error log) when the current front has failed MAX times", async () => {
        mockGetBridgeState.mockResolvedValue({
            txFailCount: MAX_FAIL_COUNT,
            txAttemptActionState: PROCESSED,
        });

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS * 60);
        expect(mockLoggerError).toHaveBeenCalledWith(
            expect.stringContaining("halted"),
            expect.objectContaining({ event: "master_halted_failed_front" }),
        );
    });

    it("does NOT halt on a stale fail count from an already-advanced front", async () => {
        mockGetBridgeState.mockResolvedValue({
            txFailCount: MAX_FAIL_COUNT,
            txAttemptActionState: "some-older-front",
        });

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockQueueAdd).toHaveBeenCalled();
        // stale identity → no backoff either
        expect(mockSleep).not.toHaveBeenCalled();
    });

    // Without backoff, MAX_FAIL_COUNT strikes are consumable within seconds of
    // a repeated failure — one bad stretch would trip the breaker instantly.
    it("backs off exponentially before retrying a front that already has strikes", async () => {
        mockGetBridgeState.mockResolvedValue({
            txFailCount: 2,
            txAttemptActionState: PROCESSED,
        });

        const m = new BridgeTxSenderMaster() as any;
        await m.handleTask();

        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS * 4);
        expect(mockQueueAdd).toHaveBeenCalled();
    });

    it("logs and sleeps when the queue add fails — nothing to revert", async () => {
        mockQueueAdd.mockRejectedValue(new Error("redis down"));

        const m = new BridgeTxSenderMaster() as any;
        await expect(m.handleTask()).resolves.toBeUndefined();

        expect(mockSleep).toHaveBeenCalledWith(MASTER_SLEEP_INTERVAL_MS);
    });
});

describe("bridge-tx-sender master — failure bookkeeping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBridgeStateFindOneAndUpdate.mockResolvedValue({ txFailCount: 1 });
    });

    function getOnJobFailed() {
        const m = new BridgeTxSenderMaster() as any;
        return m.config.onJobFailed as (
            job: any,
            error?: Error,
        ) => Promise<void>;
    }

    it("bumps txFailCount and clears the in-flight flag in one pipeline update", async () => {
        await getOnJobFailed()({ data: { fromActionState: PROCESSED } });

        expect(mockBridgeStateFindOneAndUpdate).toHaveBeenCalledWith(
            {},
            FAILURE_PIPELINE,
            { new: true },
        );
    });

    it("logs a transient failure WITHOUT charging a strike", async () => {
        const transient = Object.assign(new Error("archive lag"), {
            transient: true,
        });

        await getOnJobFailed()(
            { data: { fromActionState: PROCESSED } },
            transient as any,
        );

        expect(mockBridgeStateFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it("logs the permanent failure when the count reaches MAX_FAIL_COUNT", async () => {
        mockBridgeStateFindOneAndUpdate.mockResolvedValue({
            txFailCount: MAX_FAIL_COUNT,
        });

        await getOnJobFailed()({ data: { fromActionState: PROCESSED } });

        expect(mockLoggerError).toHaveBeenCalledWith(
            expect.stringContaining("permanently failing"),
            expect.objectContaining({ event: "bridge_tx_failed" }),
        );
    });

    it("swallows bookkeeping errors instead of raising an unhandled rejection", async () => {
        mockBridgeStateFindOneAndUpdate.mockRejectedValue(new Error("mongo down"));

        await expect(
            getOnJobFailed()({ data: { fromActionState: PROCESSED } }),
        ).resolves.toBeUndefined();
    });
});

describe("bridge-tx-sender master — onStartup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBridgeStateFindOne.mockResolvedValue(null);
        mockBridgeStateFindOneAndUpdate.mockResolvedValue({ txFailCount: 1 });
    });

    // An attempt still flagged active at boot was killed mid-flight; the
    // queue obliterate destroys BullMQ's deferred-failure evidence, so the
    // failure must be booked here or a crash-looping front retries forever.
    it("books an interrupted attempt through the failure pipeline", async () => {
        mockBridgeStateFindOne.mockResolvedValue({
            txAttemptActive: true,
            txAttemptActionState: PROCESSED,
        });

        const m = new BridgeTxSenderMaster() as any;
        await m.onStartup();

        expect(mockBridgeStateFindOneAndUpdate).toHaveBeenCalledWith(
            {},
            FAILURE_PIPELINE,
            { new: true },
        );
    });

    it("books nothing when no attempt was in flight", async () => {
        mockBridgeStateFindOne.mockResolvedValue({ txAttemptActive: false });

        const m = new BridgeTxSenderMaster() as any;
        await m.onStartup();

        expect(mockBridgeStateFindOneAndUpdate).not.toHaveBeenCalled();
    });
});
