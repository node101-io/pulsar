import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import {
    storeProof,
    getProof,
    deleteProof,
} from "./utils.js";
import { ProofModel } from "./Proof.js";

vi.mock("./Proof.js");
vi.mock("../../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("db proof utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("storeProof creates proof and returns id", async () => {
        const id = new Types.ObjectId();
        vi.mocked(ProofModel.create).mockResolvedValue({
            _id: id,
        } as any);

        const result = await storeProof("{\"a\":1}");

        expect(ProofModel.create).toHaveBeenCalledWith({ data: "{\"a\":1}" });
        expect(result.toHexString()).toBe(id.toHexString());
    });

    it("getProof returns parsed JSON and logs", async () => {
        const id = new Types.ObjectId();
        vi.mocked(ProofModel.findById).mockResolvedValue({
            _id: id,
            data: "{\"x\":42}",
        } as any);

        const result = await getProof(id);

        expect(ProofModel.findById).toHaveBeenCalledWith(id);
        expect(result).toEqual({ x: 42 });
        const logger = await import("../../../../logger.js");
        expect(logger.default.info).toHaveBeenCalledWith(
            `Retrieved proof with id ${id.toHexString()}.`,
        );
    });

    it("getProof throws when proof not found", async () => {
        const id = new Types.ObjectId();
        vi.mocked(ProofModel.findById).mockResolvedValue(null as any);

        await expect(getProof(id)).rejects.toThrow("Proof not found");
    });

    it("getProof throws when data is missing", async () => {
        const id = new Types.ObjectId();
        vi.mocked(ProofModel.findById).mockResolvedValue({ _id: id } as any);

        await expect(getProof(id)).rejects.toThrow("Proof not found");
    });

    it("deleteProof deletes proof by id and logs", async () => {
        const id = new Types.ObjectId();
        vi.mocked(ProofModel.deleteOne).mockResolvedValue({} as any);

        await deleteProof(id);

        expect(ProofModel.deleteOne).toHaveBeenCalledWith({ _id: id });
        const logger = await import("../../../../logger.js");
        expect(logger.default.info).toHaveBeenCalledWith(
            `Deleted proof with id ${id.toHexString()}.`,
        );
    });
});

