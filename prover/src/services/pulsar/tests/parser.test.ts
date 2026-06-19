import { describe, it, expect, vi } from "vitest";
import { PublicKey } from "o1js";
import {
    parseTendermintBlockResponse,
    decodeMinaSignature,
    parseValidatorSetResponse,
    parseMinaPubkeyFromBytes,
    parseValidatorSetPubkeys,
} from "../parser.js";

describe("pulsar parser", () => {
    describe("parseTendermintBlockResponse", () => {
        it("parses block header and returns blockHash, height, chainId", () => {
            const res = {
                block: {
                    header: {
                        height: "42",
                        chain_id: "pulsar-test",
                        proposer_address: "cosmos1abc",
                        app_hash:
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        time: { seconds: "1000", nanos: 0 },
                        data_hash: "",
                        validators_hash: "",
                        consensus_hash: "",
                        evidence_hash: "",
                        last_commit_hash: "",
                        last_results_hash: "",
                        next_validators_hash: "",
                    },
                    data: { txs: [] },
                    last_commit: { signatures: [] },
                },
                block_id: { hash: "deadbeef" },
            };

            const result = parseTendermintBlockResponse(res);

            expect(result.height).toBe(42);
            expect(result.blockHash).toBe("0");
            expect(result.chainId).toBe("pulsar-test");
            expect(result.proposerAddress).toBe("cosmos1abc");
            expect(result.blockId).toBe("deadbeef");
            expect(result.txs).toEqual([]);
        });

        it("handles missing optional fields", () => {
            const res = {
                block: {
                    header: {
                        height: "1",
                        app_hash:
                            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                    },
                    data: {},
                    last_commit: {},
                },
            };

            const result = parseTendermintBlockResponse(res);

            expect(result.height).toBe(1);
            expect(result.chainId).toBe("");
            expect(result.proposerAddress).toBe("");
        });
    });

    describe("parseValidatorSetResponse", () => {
        it("extracts validator addresses from response", () => {
            const res = {
                validators: [
                    { address: "cosmos1addr1" },
                    { address: "cosmos1addr2" },
                ],
            };

            const result = parseValidatorSetResponse(res);

            expect(result).toEqual(["cosmos1addr1", "cosmos1addr2"]);
        });

        it("returns empty array for empty validators", () => {
            const res = { validators: [] };
            const result = parseValidatorSetResponse(res);
            expect(result).toEqual([]);
        });
    });

    describe("parseMinaPubkeyFromBytes", () => {
        it("decodes 33-byte buffer to base58 public key", () => {
            const pubkey = PublicKey.fromBase58(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
            const fields = pubkey.toFields();
            const xBig = BigInt(fields[0].toString());
            const xHex = xBig.toString(16).padStart(64, "0");
            const isOdd = fields[1].toString() === "1" ? 1 : 0;
            const bytes = Buffer.concat([
                Buffer.from(xHex, "hex"),
                Buffer.from([isOdd]),
            ]);

            const result = parseMinaPubkeyFromBytes(bytes);

            expect(result).toBe(
                "B62qmiWoAewYZuz7tUL1yV8r718dyLhp7Ck83ckuPAhPioERpTTMNNb",
            );
        });
    });

    describe("parseValidatorSetPubkeys", () => {
        it("extracts pub_key.key fields from validators", () => {
            const res = {
                validators: [
                    { pub_key: { key: "base64key1" } },
                    { pub_key: { key: "base64key2" } },
                ],
            };

            const result = parseValidatorSetPubkeys(res);

            expect(result).toEqual(["base64key1", "base64key2"]);
        });

        it("returns empty string for missing pub_key", () => {
            const res = {
                validators: [{ pub_key: {} }, {}],
            };

            const result = parseValidatorSetPubkeys(res);

            expect(result).toEqual(["", ""]);
        });

        it("returns empty array for empty validators", () => {
            expect(parseValidatorSetPubkeys({ validators: [] })).toEqual([]);
            expect(parseValidatorSetPubkeys({})).toEqual([]);
        });
    });

    describe("decodeMinaSignature", () => {
        it("decodes 64-byte hex to base58 signature", () => {
            const rHex = "0".repeat(64);
            const sHex = "1".repeat(64);
            const sigHex = rHex + sHex;

            const result = decodeMinaSignature(sigHex);

            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
