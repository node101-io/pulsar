import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    PROOF_EPOCH_SIZE,
    SETTLER_STALL_TIMEOUT_MS,
} from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        find: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        updateOne: vi.fn(),
        updateMany: vi.fn(),
        countDocuments: vi.fn(),
    },
}));

vi.mock("../../../db/models/MinaState.js", () => ({
    resetLastSentNonce: vi.fn(),
}));

vi.mock("../../queue.js", () => ({
    settlerQ: {
        add: vi.fn(),
        getJobCounts: vi.fn(),
    },
}));

vi.mock("../../redis.js", () => ({
    connection: {},
}));

vi.mock("o1js", () => ({
    PublicKey: { fromBase58: vi.fn(() => ({})) },
}));

vi.mock("pulsar-contracts", () => ({
    checkZkappTransaction: vi.fn(),
}));

vi.mock("../../../services/mina/client.js", () => ({
    initMinaClientContext: vi.fn(async () => ({
        network: "lightnet",
        endpoint: "http://localhost:8080",
    })),
    getContractBlockHeight: vi.fn(),
}));

vi.mock("../finalize.js", () => ({
    finalizeSettledEpoch: vi.fn(),
}));

vi.mock("../worker.js", () => ({
    worker: vi.fn(),
}));

vi.mock("../../../common/sleep.js", () => ({
    sleep: vi.fn(async () => {}),
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
import { resetLastSentNonce } from "../../../db/models/MinaState.js";
import { settlerQ } from "../../queue.js";
import { checkZkappTransaction } from "pulsar-contracts";
import { getContractBlockHeight } from "../../../services/mina/client.js";
import { finalizeSettledEpoch } from "../finalize.js";
import { SettlerMaster } from "../master.js";

const H = 1000; // contract block height for most tests

/** Runs one handleTask tick on a fresh master. */
async function tick() {
    const master = new SettlerMaster();
    // handleTask is protected; the test drives exactly one tick
    await (master as any).handleTask();
}

function mockSorted(mockFn: any, result: any) {
    mockFn.mockReturnValueOnce({ sort: vi.fn().mockResolvedValue(result) });
}

describe("settler master (pipeline tick)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
        vi.mocked(getContractBlockHeight).mockResolvedValue(H);
        // defaults: nothing passed, nothing in flight, empty queue
        vi.mocked(ProofEpochModel.find).mockReturnValue({
            sort: vi.fn().mockResolvedValue([]),
        } as any);
        vi.mocked(ProofEpochModel.findOne).mockReturnValue({
            sort: vi.fn().mockResolvedValue(null),
        } as any);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue(
            null as any,
        );
        vi.mocked(ProofEpochModel.countDocuments).mockResolvedValue(0);
        vi.mocked(settlerQ.getJobCounts).mockResolvedValue({
            waiting: 0,
            active: 0,
            delayed: 0,
        } as any);
    });

    it("finalizes every epoch the contract has passed", async () => {
        const passed = [
            { height: H - 2 * PROOF_EPOCH_SIZE + 1, kind: "txSent" },
            { height: H - PROOF_EPOCH_SIZE + 1, kind: "settlement" },
        ];
        mockSorted(vi.mocked(ProofEpochModel.find), passed);

        await tick();

        expect(finalizeSettledEpoch).toHaveBeenCalledTimes(2);
        expect(finalizeSettledEpoch).toHaveBeenCalledWith(passed[0].height);
        expect(finalizeSettledEpoch).toHaveBeenCalledWith(passed[1].height);
    });

    it("resets the pipeline tail when the head tx died past the stall timeout", async () => {
        const headHeight = H + 1;
        vi.mocked(ProofEpochModel.findOne)
            // stall check: oldest txSent, sent long ago
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue({
                    height: headHeight,
                    kind: "txSent",
                    sentTxHash: "dead-tx",
                    sentAt: new Date(Date.now() - SETTLER_STALL_TIMEOUT_MS - 1000),
                }),
            } as any);
        vi.mocked(checkZkappTransaction).mockResolvedValue({
            success: false,
            failureReason: [["Account_app_state_precondition_unsatisfied"]],
        } as any);
        vi.mocked(ProofEpochModel.updateMany).mockResolvedValue({
            modifiedCount: 3,
        } as any);

        await tick();

        expect(ProofEpochModel.updateMany).toHaveBeenCalledWith(
            { kind: "txSent", height: { $gte: headHeight } },
            {
                $set: {
                    kind: "settlement",
                    sentTxHash: null,
                    sentNonce: null,
                    sentAt: null,
                },
            },
        );
        expect(resetLastSentNonce).toHaveBeenCalled();
        // reset ends the tick — no new claim until the next one
        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("re-arms the stall timer instead of resetting when the head tx is included", async () => {
        const headHeight = H + 1;
        vi.mocked(ProofEpochModel.findOne)
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue({
                    height: headHeight,
                    kind: "txSent",
                    sentTxHash: "slow-but-alive",
                    sentAt: new Date(Date.now() - SETTLER_STALL_TIMEOUT_MS - 1000),
                }),
            } as any)
            // send phase: highest pipelined epoch
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue(null),
            } as any);
        vi.mocked(checkZkappTransaction).mockResolvedValue({
            success: true,
            failureReason: null,
        } as any);

        await tick();

        expect(ProofEpochModel.updateMany).not.toHaveBeenCalled();
        expect(resetLastSentNonce).not.toHaveBeenCalled();
        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: headHeight },
            { $set: { sentAt: expect.any(Date) } },
        );
    });

    it("does not touch a young in-flight tx", async () => {
        vi.mocked(ProofEpochModel.findOne)
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue({
                    height: H + 1,
                    kind: "txSent",
                    sentTxHash: "fresh-tx",
                    sentAt: new Date(),
                }),
            } as any)
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue(null),
            } as any);

        await tick();

        expect(checkZkappTransaction).not.toHaveBeenCalled();
        expect(ProofEpochModel.updateMany).not.toHaveBeenCalled();
    });

    it("claims the successor of the highest in-flight epoch", async () => {
        const highestSent = H + 1 + PROOF_EPOCH_SIZE;
        vi.mocked(ProofEpochModel.findOne)
            // stall check: nothing old
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue(null),
            } as any)
            // send phase: highest pipelined
            .mockReturnValueOnce({
                sort: vi.fn().mockResolvedValue({
                    height: highestSent,
                    kind: "txSent",
                }),
            } as any);
        vi.mocked(ProofEpochModel.countDocuments).mockResolvedValue(2);
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: highestSent + PROOF_EPOCH_SIZE,
        } as any);

        await tick();

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            {
                kind: { $eq: "settlement" },
                height: { $eq: highestSent + PROOF_EPOCH_SIZE },
            },
            { $set: { kind: "txSending" } },
            { returnDocument: "before" },
        );
        expect(settlerQ.add).toHaveBeenCalledWith("settler", {
            height: highestSent + PROOF_EPOCH_SIZE,
        });
    });

    it("claims contract height + 1 when nothing is in flight", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: H + 1,
        } as any);

        await tick();

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ height: { $eq: H + 1 } }),
            expect.anything(),
            expect.anything(),
        );
        expect(settlerQ.add).toHaveBeenCalledWith("settler", { height: H + 1 });
    });

    it("does not claim when the window is full", async () => {
        vi.mocked(ProofEpochModel.countDocuments).mockResolvedValue(5);

        await tick();

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(settlerQ.add).not.toHaveBeenCalled();
    });

    it("does not claim while a settler job is already queued", async () => {
        vi.mocked(settlerQ.getJobCounts).mockResolvedValue({
            waiting: 1,
            active: 0,
            delayed: 0,
        } as any);

        await tick();

        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(settlerQ.add).not.toHaveBeenCalled();
    });

    it("returns the claim when enqueueing fails", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            height: H + 1,
        } as any);
        vi.mocked(settlerQ.add).mockRejectedValue(new Error("redis down"));

        await expect(tick()).rejects.toThrow("redis down");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: H + 1, kind: "txSending" },
            { $set: { kind: "settlement" } },
        );
    });

    it("returns only stale txSending claims to settlement (age-gated sweep)", async () => {
        vi.mocked(ProofEpochModel.updateMany).mockResolvedValue({
            modifiedCount: 2,
        } as any);

        const master = new SettlerMaster() as any;
        await master.recoverStaleClaims();

        expect(ProofEpochModel.updateMany).toHaveBeenCalledWith(
            { kind: "txSending", updatedAt: { $lt: expect.any(Date) } },
            { $set: { kind: "settlement" } },
        );
    });
});

// Pins the proof-burn guard from the 2026-08-21/22 outage: every broadcast
// 502/504'd, each third failure hit MAX_FAIL_COUNT and threw away a
// multi-hour settlement proof, and the pipeline re-proved the same epoch in
// a loop. A transport failure must hand the epoch back to settlement WITHOUT
// advancing the counter; only a daemon that actually judged the tx may push
// an epoch toward re-proving.
describe("settler master (broadcast failure classification)", () => {
    const JOB = { data: { height: 1234 } } as any;

    async function fail(message: string) {
        const master = new SettlerMaster();
        await (master as any).config.onJobFailed(JOB, new Error(message));
    }

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CONTRACT_ADDRESS = "B62qtest";
        process.env.MINA_NETWORK = "lightnet";
    });

    it.each([
        // Verbatim from o1js during the outage — nginx in front of o1test.
        'Transaction failed with errors:\n- {"statusCode":502,"statusText":"Bad Gateway"}',
        // Minascan mid-outage, before its gateway started answering at all.
        'Transaction failed with errors:\n- {"statusCode":504,"statusText":"Gateway Timeout"}',
        // Minascan mid-BOOTSTRAP: the daemon's own words for "not my fault".
        "Couldn't send zkApp command: (failure \"We don't have a transition frontier at the moment, so we're unable to verify any transactions.\")",
        "fetch failed",
        "connect ECONNREFUSED 1.2.3.4:443",
    ])("returns the epoch to settlement without a failCount for: %s", async (message) => {
        await fail(message);

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: JOB.data.height, kind: "txSending" },
            { $set: { kind: "settlement" } },
        );
        expect(ProofEpochModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("counts a real daemon rejection toward MAX_FAIL_COUNT", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            failCount: 1,
        } as any);

        await fail(
            "Settlement broadcast rejected by the node: [\"Invalid_nonce\"]",
        );

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height: JOB.data.height, kind: "txSending" },
            { $inc: { failCount: 1 } },
            { returnDocument: "after" },
        );
        // Below MAX_FAIL_COUNT: back to settlement, proof kept.
        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: JOB.data.height },
            { $set: { kind: "settlement" } },
        );
    });

    it("burns the proof only when a real rejection trips MAX_FAIL_COUNT", async () => {
        vi.mocked(ProofEpochModel.findOneAndUpdate).mockResolvedValue({
            failCount: 3,
        } as any);

        await fail("Settlement broadcast rejected by the node: [\"whatever\"]");

        expect(ProofEpochModel.updateOne).toHaveBeenCalledWith(
            { height: JOB.data.height },
            {
                $set: {
                    kind: "aggregation",
                    provedTxJson: null,
                    failCount: 0,
                },
            },
        );
    });
});
