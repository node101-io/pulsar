import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicKey } from "o1js";
import {
    computeValidatorListHash,
    getLatestHeight,
    getBlockData,
    getMinaPubKeyFromCosmosAddress,
    getCosmosValidatorSet,
    getValidatorSet,
    getVoteExt,
    storePulsarBlock,
} from "./client.js";
import * as db from "../../db/index.js";

vi.mock("../../db/index.js");
vi.mock("../../common/logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

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

    describe("getCosmosValidatorSet", () => {
        it("returns validator addresses from Tendermint client", async () => {
            const mockTmClient = {
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [
                            { address: "cosmos1addr1" },
                            { address: "cosmos1addr2" },
                        ],
                    });
                }),
            };

            const validators = await getCosmosValidatorSet(mockTmClient, 100);

            expect(validators).toEqual(["cosmos1addr1", "cosmos1addr2"]);
            expect(mockTmClient.GetValidatorSetByHeight).toHaveBeenCalledWith(
                { height: "100" },
                expect.any(Function),
            );
        });

        it("rejects on gRPC error", async () => {
            const mockTmClient = {
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(
                getCosmosValidatorSet(mockTmClient, 100),
            ).rejects.toThrow("gRPC error");
        });
    });

    describe("getMinaPubKeyFromCosmosAddress", () => {
        it("retrieves Mina public key for Cosmos address", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const mockMkClient = {
                KeyStore: vi.fn((req, callback) => {
                    callback(null, {
                        keyStore: {
                            minaPublicKey: "encoded_address",
                        },
                    });
                }),
                GetMinaPubkey: vi.fn((req, callback) => {
                    callback(null, {
                        x: mockPubkey.toFields()[0].toString(),
                        is_odd:
                            mockPubkey.toFields()[1].toString() === "1"
                                ? "true"
                                : "false",
                    });
                }),
            };

            const pubkey = await getMinaPubKeyFromCosmosAddress(
                mockMkClient,
                "cosmos1addr",
            );

            expect(typeof pubkey).toBe("string");
            expect(pubkey.length).toBeGreaterThan(0);
            expect(mockMkClient.KeyStore).toHaveBeenCalledWith(
                { index: "cosmos1addr" },
                expect.any(Function),
            );
        });

        it("rejects when no Mina public key found", async () => {
            const mockMkClient = {
                KeyStore: vi.fn((req, callback) => {
                    callback(null, {
                        keyStore: {},
                    });
                }),
            };

            await expect(
                getMinaPubKeyFromCosmosAddress(mockMkClient, "cosmos1addr"),
            ).rejects.toThrow("No Mina public key found");
        });
    });

    describe("getValidatorSet", () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it("converts Cosmos validators to Mina public keys", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const mockTmClient = {
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [
                            { address: "cosmos1addr1" },
                            { address: "cosmos1addr2" },
                        ],
                    });
                }),
            };
            const mockMkClient = {
                KeyStore: vi.fn((req, callback) => {
                    callback(null, {
                        keyStore: {
                            minaPublicKey: "encoded_address",
                        },
                    });
                }),
                GetMinaPubkey: vi.fn((req, callback) => {
                    callback(null, {
                        x: mockPubkey.toFields()[0].toString(),
                        is_odd:
                            mockPubkey.toFields()[1].toString() === "1"
                                ? "true"
                                : "false",
                    });
                }),
            };

            const validators = await getValidatorSet(
                mockTmClient,
                mockMkClient,
                100,
            );

            expect(validators).toHaveLength(2);
            expect(validators.every((v) => typeof v === "string")).toBe(true);
        });

        it("throws error when no validators found", async () => {
            const mockTmClient = {
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [],
                    });
                }),
            };
            const mockMkClient = {};

            await expect(
                getValidatorSet(mockTmClient, mockMkClient, 100),
            ).rejects.toThrow("No validators found");
        });

        it("continues when individual validator key retrieval fails", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const mockTmClient = {
                GetValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [
                            { address: "cosmos1addr1" },
                            { address: "cosmos1addr2" },
                        ],
                    });
                }),
            };
            const mockMkClient = {
                KeyStore: vi.fn((req, callback) => {
                    if (req.index === "cosmos1addr1") {
                        callback(new Error("Key not found"), null);
                    } else {
                        callback(null, {
                            keyStore: {
                                minaPublicKey: "encoded_address",
                            },
                        });
                    }
                }),
                GetMinaPubkey: vi.fn((req, callback) => {
                    callback(null, {
                        x: mockPubkey.toFields()[0].toString(),
                        is_odd:
                            mockPubkey.toFields()[1].toString() === "1"
                                ? "true"
                                : "false",
                    });
                }),
            };

            const validators = await getValidatorSet(
                mockTmClient,
                mockMkClient,
                100,
            );

            expect(validators.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe("getVoteExt", () => {
        it("retrieves vote extensions with pagination", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            let callCount = 0;
            const mockMkClient = {
                VoteExtByHeight: vi.fn((req, callback) => {
                    callCount++;
                    if (callCount === 1) {
                        callback(null, {
                            voteExt: [
                                {
                                    index: "0",
                                    height: "100",
                                    validatorAddr: "encoded1",
                                    signature: "0".repeat(128),
                                },
                            ],
                            pagination: { next_key: Buffer.from("next") },
                        });
                    } else {
                        callback(null, {
                            voteExt: [
                                {
                                    index: "1",
                                    height: "100",
                                    validatorAddr: "encoded2",
                                    signature: "1".repeat(128),
                                },
                            ],
                            pagination: { next_key: null },
                        });
                    }
                }),
                GetMinaPubkey: vi.fn((req, callback) => {
                    callback(null, {
                        x: mockPubkey.toFields()[0].toString(),
                        is_odd:
                            mockPubkey.toFields()[1].toString() === "1"
                                ? "true"
                                : "false",
                    });
                }),
            };

            const voteExt = await getVoteExt(mockMkClient, 100);

            expect(voteExt.length).toBeGreaterThanOrEqual(1);
            expect(mockMkClient.VoteExtByHeight).toHaveBeenCalledTimes(2);
        });

        it("handles empty vote extensions", async () => {
            const mockMkClient = {
                VoteExtByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        voteExt: [],
                        pagination: { next_key: null },
                    });
                }),
            };

            const voteExt = await getVoteExt(mockMkClient, 100);

            expect(voteExt).toEqual([]);
        });

        it("rejects on gRPC error", async () => {
            const mockMkClient = {
                VoteExtByHeight: vi.fn((req, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(getVoteExt(mockMkClient, 100)).rejects.toThrow(
                "gRPC error",
            );
        });
    });

    describe("getBlockData", () => {
        it("retrieves complete block data", async () => {
            const mockPubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
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
                        validators: [{ address: "cosmos1addr" }],
                    });
                }),
            };
            const mockMkClient = {
                KeyStore: vi.fn((req, callback) => {
                    callback(null, {
                        keyStore: {
                            minaPublicKey: "encoded_address",
                        },
                    });
                }),
                GetMinaPubkey: vi.fn((req, callback) => {
                    callback(null, {
                        x: mockPubkey.toFields()[0].toString(),
                        is_odd:
                            mockPubkey.toFields()[1].toString() === "1"
                                ? "true"
                                : "false",
                    });
                }),
                VoteExtByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        voteExt: [],
                        pagination: { next_key: null },
                    });
                }),
            };

            const blockData = await getBlockData(
                mockTmClient,
                mockMkClient,
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

            vi.mocked(db.storeBlock).mockResolvedValue(undefined);

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

            vi.mocked(db.storeBlock).mockResolvedValue(undefined);

            await storePulsarBlock(blockData);

            const callArgs = vi.mocked(db.storeBlock).mock.calls[0][0];
            const expectedHash = computeValidatorListHash(validators);
            expect(callArgs.validatorListHash).toBe(expectedHash);
        });
    });
});
