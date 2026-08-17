import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/models/ProofEpoch.js", () => ({
    ProofEpochModel: {
        findOne: vi.fn(),
    },
}));

vi.mock("../../childProver.js", () => ({
    runProvingJobInChild: vi.fn(),
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { ProofEpochModel } from "../../../db/models/ProofEpoch.js";
import { runProvingJobInChild } from "../../childProver.js";
import { worker } from "../worker.js";

const PROOF_ID = "507f1f77bcf86cd799439011";

describe("settlement-prover worker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws when epoch not found", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue(null as any);

        await expect(
            worker({ height: 10, settlementProofId: PROOF_ID }),
        ).rejects.toThrow("ProofEpoch at height 10 not found.");
    });

    it.each(["settlement", "txSending", "done"])(
        "skips proving when epoch kind is %s (idempotency)",
        async (kind) => {
            vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
                height: 16,
                kind,
            } as any);

            await worker({ height: 16, settlementProofId: PROOF_ID });

            expect(runProvingJobInChild).not.toHaveBeenCalled();
        },
    );

    it("hands the epoch to a proving child", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);

        await worker({ height: 16, settlementProofId: PROOF_ID });

        expect(runProvingJobInChild).toHaveBeenCalledWith(
            expect.stringContaining("prove-main.js"),
            ["16", PROOF_ID],
            { epochHeight: 16 },
        );
    });

    it("propagates a failing child so the master can strike the epoch", async () => {
        vi.mocked(ProofEpochModel.findOne).mockResolvedValue({
            height: 16,
            kind: "txProving",
        } as any);
        vi.mocked(runProvingJobInChild).mockRejectedValue(
            new Error("prover froze"),
        );

        await expect(
            worker({ height: 16, settlementProofId: PROOF_ID }),
        ).rejects.toThrow("prover froze");
    });
});
