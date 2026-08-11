import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicKey } from "o1js";
import {
    getLatestHeight,
    type AbciQueryClient,
    type KeyregistryClient,
    type TendermintClient,
    type VotePersistenceClient,
} from "pulsar-chain-client";
import {
    computeValidatorListHash,
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

// Verbatim from the chain's cross-language fixture
// (scripts/vote-ext-verifier/actions-root-vectors.json): the base64 the wire
// carries and the field element its Go tests assert it decodes to.
const CHAIN_ACTIONS_ROOT_VECTOR = {
    base64: "KKhZhIikWJfh4jhbhfpmmeq1ZdrPvTIbZtwKcsCe9Ro=",
    decimal:
        "18389962078741328244067350182709210827719642147845999328709309946826497914138",
};

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
                {
                    addr: "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                    power: "1",
                },
            ];

            const result = computeValidatorListHash(validators);

            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        it("returns same hash for same validators", () => {
            const validators = [
                {
                    addr: "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                    power: "1",
                },
            ];

            const a = computeValidatorListHash(validators);
            const b = computeValidatorListHash(validators);

            expect(a).toBe(b);
        });
    });

    describe("getLatestHeight", () => {
        it("returns latest block height from Tendermint client", async () => {
            const mockTmClient = {
                getLatestBlock: vi.fn((req, callback) => {
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

            const height = await getLatestHeight(mockTmClient as unknown as TendermintClient);

            expect(height).toBe(100);
            expect(mockTmClient.getLatestBlock).toHaveBeenCalledWith(
                {},
                expect.any(Function),
            );
        });

        it("rejects on gRPC error", async () => {
            const mockTmClient = {
                getLatestBlock: vi.fn((req, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(getLatestHeight(mockTmClient as unknown as TendermintClient)).rejects.toThrow(
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
                voteExtensions: vi.fn((req, metadata, callback) => {
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

            const voteExt = await getVoteExtsByHeight(mockVpClient as unknown as VotePersistenceClient, 100);

            expect(voteExt).toHaveLength(1);
            expect(typeof voteExt[0].validatorAddr).toBe("string");
            expect(typeof voteExt[0].signature).toBe("string");
        });

        it("returns empty array when persisted height does not match (vote exts not available yet)", async () => {
            const mockVpClient = {
                voteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "99",
                        vote_extensions: [],
                    });
                }),
            };

            const result = await getVoteExtsByHeight(mockVpClient as unknown as VotePersistenceClient, 100);
            expect(result).toEqual([]);
        });

        it("returns empty array when persisted height is absent (early block)", async () => {
            const mockVpClient = {
                voteExtensions: vi.fn((req, metadata, callback) => {
                    // Only query_block_height present, no persisted field
                    callback(null, { query_block_height: "3" });
                }),
            };

            const result = await getVoteExtsByHeight(mockVpClient as unknown as VotePersistenceClient, 1);
            expect(result).toEqual([]);
        });

        it("rejects on gRPC error", async () => {
            const mockVpClient = {
                voteExtensions: vi.fn((req, metadata, callback) => {
                    callback(new Error("gRPC error"), null);
                }),
            };

            await expect(getVoteExtsByHeight(mockVpClient as unknown as VotePersistenceClient, 100)).rejects.toThrow(
                "gRPC error",
            );
        });

        it("passes x-cosmos-block-height: H+3 in metadata", async () => {
            const mockVpClient = {
                voteExtensions: vi.fn((req, metadata, callback) => {
                    callback(null, {
                        persisted_vote_extensions_block_height: "50",
                        vote_extensions: [],
                    });
                }),
            };

            await getVoteExtsByHeight(mockVpClient as unknown as VotePersistenceClient, 50);

            const [, metadata] = mockVpClient.voteExtensions.mock.calls[0];
            expect(metadata.get("x-cosmos-block-height")).toEqual(["53"]);
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
                getBlockByHeight: vi.fn((req, callback) => {
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
                getValidatorSetByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        validators: [
                            {
                                // protobuf Any: 2-byte field header + 32-byte key
                                pub_key: {
                                    value: Buffer.concat([
                                        Buffer.from([0x0a, 0x20]),
                                        pubkeyBytes.subarray(0, 32),
                                    ]).toString("base64"),
                                },
                                voting_power: "1",
                            },
                        ],
                    });
                }),
            };

            const mockVpClient = {
                voteExtensions: vi.fn((req, metadata, callback) => {
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
                getValidatorSetWithMinaKeys: vi.fn(
                    (req, metadata, callback) => {
                        callback(null, {
                            registered_validators: req.validators.map(
                                (v: {
                                    validator_cosmos_pub_key: Uint8Array;
                                    consensus_power: string;
                                }) => ({
                                    validator_cosmos_pub_key:
                                        v.validator_cosmos_pub_key,
                                    validator_mina_pub_key: pubkeyBytes,
                                    consensus_power: v.consensus_power,
                                }),
                            ),
                        });
                    },
                ),
            };

            const mockAbciClient = {
                voteExtBodyByHeight: vi.fn((req, callback) => {
                    callback(null, {
                        vote_ext_body: {
                            next_validator_set_hash: pubkeyBytes,
                            current_state_root: Buffer.alloc(32, 0),
                            current_block_height: "100",
                            actions_reduced_root: Buffer.from(
                                CHAIN_ACTIONS_ROOT_VECTOR.base64,
                                "base64",
                            ),
                        },
                    });
                }),
            };

            const blockData = await getBlockData(
                mockTmClient as unknown as TendermintClient,
                mockVpClient as unknown as VotePersistenceClient,
                mockKrClient as unknown as KeyregistryClient,
                mockAbciClient as unknown as AbciQueryClient,
                100,
            );

            expect(blockData.height).toBe(100);
            expect(blockData.stateRoot).toBeDefined();
            expect(Array.isArray(blockData.validators)).toBe(true);
            expect(Array.isArray(blockData.voteExt)).toBe(true);
            // The root is proto `bytes` — the raw big-endian field the
            // validators signed. Reading those bytes any other way (e.g. as a
            // UTF-8 string) yields a different field element, and the block
            // proof then commits to something nobody signed.
            expect(blockData.actionsReducedRoot).toBe(
                CHAIN_ACTIONS_ROOT_VECTOR.decimal,
            );
        });

        it("refuses the body-less fallback when the actions root is already non-zero", async () => {
            // VoteExtBodyByHeight fails transiently...
            const mockAbciClient = {
                voteExtBodyByHeight: vi.fn((req, callback) => {
                    callback(new Error("transient unavailable"), null);
                }),
            };
            // ...and the previous block proves the chain's root is non-zero,
            // so defaulting to "0" would poison the signed message
            vi.mocked(db.BlockModel.findOne).mockResolvedValue({
                height: 99,
                actionsReducedRoot: CHAIN_ACTIONS_ROOT_VECTOR.decimal,
            } as any);

            await expect(
                getBlockData(
                    {} as unknown as TendermintClient,
                    {} as unknown as VotePersistenceClient,
                    {} as unknown as KeyregistryClient,
                    mockAbciClient as unknown as AbciQueryClient,
                    100,
                ),
            ).rejects.toThrow(/refusing the "0" fallback/);
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
                    {
                        addr: "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                        power: "1",
                    },
                ],
                actionsReducedRoot: "0",
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
                {
                    addr: "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
                    power: "1",
                },
            ];
            const blockData = {
                height: 100,
                stateRoot: "0x123",
                validators,
                actionsReducedRoot: "0",
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
