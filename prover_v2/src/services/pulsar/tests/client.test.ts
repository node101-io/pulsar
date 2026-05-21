import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicKey } from "o1js";
import {
    computeValidatorListHash,
    getLatestHeight,
    getBlockData,
    getVoteExtsByHeight,
    storePulsarBlock,
} from "../client.js";
import * as db from "../../../db/index.js";

vi.mock("../../../db/index.js");
vi.mock("../../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

// 33-byte Mina pubkey bytes: X[32] || isOdd[1]
function makePubkeyBytes(pubkey: PublicKey): Buffer {
    const fields = pubkey.toFields();
    const xBig = BigInt(fields[0].toString());
    const xHex = xBig.toString(16).padStart(64, "0");
    const isOdd = fields[1].toString() === "1" ? 1 : 0;
    return Buffer.concat([Buffer.from(xHex, "hex"), Buffer.from([isOdd])]);
}

describe("pulsar client", () => {
    describe("computeValidatorListHash", () => {
        it("returns hash string for validator list", () => {
            const validators = [
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            ];

            const result = computeValidatorListHash(validators);

            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        it("returns same hash for same validators", () => {
            const validators = [
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            ];

            const a = computeValidatorListHash(validators);
            const b = computeValidatorListHash(validators);

            expect(a).toBe(b);
        });
    });

    describe("getLatestHeight", () => {
        it("returns latest block height from Tendermint client", async () => {
            const mockTmClient = {
                GetLatestBlock: vi.fn((req, callback) => {
                    callback(null, {
                        block: {
                            header: {
                                height: "100",
                                app_hash:
                                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                            },
                            data: { txs: [] },
                            last_commit: { signatures: [] },
                        },
                    });
                }),
            };

            const height = await getLatestHeight(mockTmClient);

            expect(height).toBe(100);
            expect(mockTmClient.GetLatestBlock).toHaveBeenCalledWith(
                {},
                expect.any(Function),
            );
        });

        it("rejects on gRPC error", async () => {
            const mockTmClient = {
                GetLatestBlock: vi.fn((req, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(getLatestHeight(mockTmClient)).rejects.toThrow(
                "gRPC error",
            );
        });
    });

    describe("getVoteExtsByHeight", () => {
        it("returns vote extensions for given height via x-cosmos-block-height header", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const pubkeyBytes = makePubkeyBytes(mockPubkey);
            const sigBytes = Buffer.alloc(64, 0);

            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "100",
                        vote_extensions: [
                            {
                                mina_public_key: pubkeyBytes.toString("base64"),
                                vote_extension: sigBytes.toString("base64"),
                            },
                        ],
                    });
                }),
            };

            const voteExt = await getVoteExtsByHeight(mockVpClient, 100);

            expect(voteExt).toHaveLength(1);
            expect(voteExt[0].height).toBe(100);
            expect(typeof voteExt[0].validatorAddr).toBe("string");
            expect(typeof voteExt[0].signature).toBe("string");
        });

        it("returns empty array when persisted height does not match (vote exts not available yet)", async () => {
            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "99",
                        vote_extensions: [],
                    });
                }),
            };

            const result = await getVoteExtsByHeight(mockVpClient, 100);
            expect(result).toEqual([]);
        });

        it("returns empty array when persisted height is absent (early block)", async () => {
            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    // Only query_block_height present, no persisted field
                    callback(null, { query_block_height: "3" });
                }),
            };

            const result = await getVoteExtsByHeight(mockVpClient, 1);
            expect(result).toEqual([]);
        });

        it("rejects on gRPC error", async () => {
            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(getVoteExtsByHeight(mockVpClient, 100)).rejects.toThrow(
                "gRPC error",
            );
        });

        it("passes x-cosmos-block-height: H+2 in metadata", async () => {
            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "50",
                        vote_extensions: [],
                    });
                }),
            };

            await getVoteExtsByHeight(mockVpClient, 50);

            const [, metadata] = mockVpClient.VoteExtensions.mock.calls[0];
            expect(metadata.get("x-cosmos-block-height")).toEqual(["52"]);
        });
    });

    describe("getBlockData", () => {
        it("retrieves complete block data", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const pubkeyBytes = makePubkeyBytes(mockPubkey);
            const sigBytes = Buffer.alloc(64, 0);

            const mockTmClient = {
                GetBlockByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        block: {
                            header: {
                                height: "100",
                                app_hash:
                                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                            },
                            data: { txs: [] },
                            last_commit: { signatures: [] },
                        },
                    });
                }),
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [
                            { pub_key: { key: pubkeyBytes.toString("base64") } },
                        ],
                    });
                }),
            };

            const mockVpClient = {
                VoteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "100",
                        vote_extensions: [
                            {
                                mina_public_key: pubkeyBytes.toString("base64"),
                                vote_extension: sigBytes.toString("base64"),
                            },
                        ],
                    });
                }),
            };

            const mockKrClient = {
                GetValidatorMinaPubKey: vi.fn((req, callback) => {
                    callback(null, {
                        validator_mina_pub_key: pubkeyBytes,
                    });
                }),
            };

            const blockData = await getBlockData(
                mockTmClient,
                mockVpClient,
                mockKrClient,
                100,
            );

            expect(blockData.height).toBe(100);
            expect(blockData.stateRoot).toBeDefined();
            expect(Array.isArray(blockData.validators)).toBe(true);
            expect(Array.isArray(blockData.voteExt)).toBe(true);
        });
    });

    describe("storePulsarBlock", () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it("stores block with validator list hash", async () => {
            const blockData = {
                height: 100,
                stateRoot: "0x123",
                validators: [
                    "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                ],
                voteExt: [],
            };

            vi.mocked(db.storeBlock).mockResolvedValue({ _id: "mock_id" } as any);
            vi.mocked(db.storeBlockInBlockEpoch).mockResolvedValue(undefined as any);

            await storePulsarBlock(blockData);

            expect(db.storeBlock).toHaveBeenCalledWith(
                expect.objectContaining({
                    height: 100,
                    stateRoot: "0x123",
                    validators: blockData.validators,
                    validatorListHash: expect.any(String),
                }),
            );
        });

        it("computes validator list hash correctly", async () => {
            const validators = [
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            ];
            const blockData = {
                height: 100,
                stateRoot: "0x123",
                validators,
                voteExt: [],
            };

            vi.mocked(db.storeBlock).mockResolvedValue({ _id: "mock_id" } as any);
            vi.mocked(db.storeBlockInBlockEpoch).mockResolvedValue(undefined as any);

            await storePulsarBlock(blockData);

            const callArgs = vi.mocked(db.storeBlock).mock.calls[0][0];
            const expectedHash = computeValidatorListHash(validators);
            expect(callArgs.validatorListHash).toBe(expectedHash);
        });
    });
});
