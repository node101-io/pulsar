import { describe, it, expect } from "vitest";

// Deliberately UNMOCKED — the worker tests mock this module wholesale, which
// once hid a real crash on the cross-package path (validator base58 →
// PublicKey → shared leaf fold). These tests run it for real.
// (Wire-format parsing tests live in pulsar-chain-client/src/parser.test.ts.)
import { validatorSetHash } from "../validatorSet.js";
import { Field, PrivateKey, PublicKey } from "o1js";
import { computeValidatorListHash } from "pulsar-contracts";

describe("validatorSetHash", () => {
    it("reproduces the shared contracts leaf fold from base58 inputs", () => {
        const validators = [1n, 2n, 3n].map((i) => ({
            minaPublicKey: PrivateKey.fromBigInt(i).toPublicKey().toBase58(),
            power: "1",
        }));

        const expected = computeValidatorListHash(
            validators.map((v) => ({
                publicKey: PublicKey.fromBase58(v.minaPublicKey),
                power: Field(1),
            })),
        ).toString();

        expect(validatorSetHash(validators)).toBe(expected);
    });
});
