import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Types } from "mongoose";
import {
    getProofEpoch,
    storeProofInProofEpoch,
    deleteProofEpoch,
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../models/ProofEpoch.js";
import {
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SETTLEMENT_INDEX,
} from "../../config/constants.js";

vi.mock("../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("db proofEpoch utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("getProofEpoch finds epoch by height", async () => {
        const mockEpoch = { height: 16 } as any;
        vi.spyOn(ProofEpochModel, "findOne").mockResolvedValue(mockEpoch);

        const result = await getProofEpoch(16);

        expect(ProofEpochModel.findOne).toHaveBeenCalledWith({ height: 16 });
        expect(result).toBe(mockEpoch);
    });

    it("storeProofInProofEpoch throws when index is out of range", async () => {
        const height = 10;
        const proofId = new Types.ObjectId();

        await expect(
            storeProofInProofEpoch(height, proofId, -1),
        ).rejects.toThrow("Index must be between 0 and");
        await expect(
            storeProofInProofEpoch(
                height,
                proofId,
                PROOF_EPOCH_SETTLEMENT_INDEX + 1,
            ),
        ).rejects.toThrow("Index must be between 0 and");
    });

    it("storeProofInProofEpoch sets proof at index and marks status as done for internal nodes", async () => {
        const height = 10;
        const proofId = new Types.ObjectId();
        vi.spyOn(ProofEpochModel, "findOneAndUpdate").mockResolvedValue(
            {} as any,
        );

        const leafIndex = 1;
        await storeProofInProofEpoch(height, proofId, leafIndex);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height },
            {
                $set: {
                    [`proofs.${leafIndex}`]: proofId,
                },
            },
        );

        const internalIndex = PROOF_EPOCH_LEAF_COUNT;
        await storeProofInProofEpoch(height, proofId, internalIndex);

        expect(ProofEpochModel.findOneAndUpdate).toHaveBeenCalledWith(
            { height },
            {
                $set: {
                    [`proofs.${internalIndex}`]: proofId,
                    [`status.${internalIndex % PROOF_EPOCH_LEAF_COUNT}`]:
                        "done",
                },
            },
        );
    });

    it("deleteProofEpoch deletes epoch by height", async () => {
        vi.spyOn(ProofEpochModel, "deleteOne").mockResolvedValue({} as any);

        await deleteProofEpoch(8);

        expect(ProofEpochModel.deleteOne).toHaveBeenCalledWith({ height: 8 });
    });

    it("incrementProofEpochFailCount increments failCount and updates timeoutAt", async () => {
        vi.spyOn(ProofEpochModel, "updateOne").mockResolvedValue({} as any);

        await incrementProofEpochFailCount(8);

        const call = vi.mocked(ProofEpochModel.updateOne).mock
            .calls[0][1] as any;
        expect(call.$inc).toEqual({ failCount: 1 });
        expect(call.$set.timeoutAt).toBeInstanceOf(Date);
    });
});
