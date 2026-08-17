import { describe, it, expect, vi, beforeEach } from "vitest";
import { BLOCK_EPOCH_SIZE } from "../../../config/constants.js";

vi.mock("../../../db/index.js", () => ({
    ProofEpochModel: {
        updateOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
    },
    BlockEpochModel: {
        findOneAndUpdate: vi.fn(),
    },
    storeProof: vi.fn(),
    fetchBlockRange: vi.fn(),
}));

vi.mock("o1js", () => ({
    Cache: { FileSystem: vi.fn(() => ({})) },
    Field: Object.assign(vi.fn(), { from: vi.fn() }),
    PublicKey: { fromBase58: vi.fn() },
    Signature: { fromValue: vi.fn(() => ({})), fromBase58: vi.fn() },
}));

vi.mock("pulsar-contracts", () => ({
    GeneratePulsarBlock: vi.fn(),
    GenerateSettlementProof: vi.fn(),
    SignaturePublicKeyList: { fromArray: vi.fn() },
    MultisigVerifierProgram: { compile: vi.fn(async () => ({})) },
}));

vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { fetchBlockRange, storeProof } from "../../../db/index.js";
import { createProof } from "../proving.js";

describe("block-prover proving", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses to prove a short block range", async () => {
        // The usual cause is the chain not having persisted this range's vote
        // extensions yet. Proving anyway would store a proof over blocks that
        // are not the ones the epoch covers.
        vi.mocked(fetchBlockRange).mockResolvedValue(
            Array(BLOCK_EPOCH_SIZE).fill({}) as any,
        );

        await expect(createProof(8)).rejects.toThrow(/Expected .* blocks/);
        expect(storeProof).not.toHaveBeenCalled();
    });
});
