import { describe, it, expect, vi } from "vitest";
import { PublicKey } from "o1js";
import { decodeMinaSignature, parseMinaPubkeyFromBytes } from "./parser.js";

describe("pulsar parser", () => {
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

    describe("decodeMinaSignature", () => {
        it("decodes 64 little-endian bytes to base58 signature", () => {
            const sigBytes = Buffer.concat([
                Buffer.alloc(32, 0x00), // r
                Buffer.alloc(32, 0x11), // s
            ]);

            const result = decodeMinaSignature(sigBytes);

            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        it("rejects a buffer that is not 64 bytes", () => {
            expect(() => decodeMinaSignature(Buffer.alloc(63))).toThrow(
                "64 bytes",
            );
        });
    });
});
