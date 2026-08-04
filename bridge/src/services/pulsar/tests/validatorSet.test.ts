import { describe, it, expect, vi, afterEach } from "vitest";

// The env module is mocked so each test can control the override / gRPC
// endpoint; parsing and shape validation of VALIDATOR_SET_OVERRIDE live in
// the env schema and are tested in src/config/tests/env.test.ts.
const { envMock } = vi.hoisted(() => ({
    envMock: {
        NODE_ENV: "test",
        VALIDATOR_SET_OVERRIDE: undefined as
            | { minaPublicKey: string; power: string }[]
            | undefined,
        PULSAR_GRPC_ENDPOINT: undefined as string | undefined,
    },
}));
vi.mock("../../../config/env.js", () => ({ env: envMock }));

// Deliberately UNMOCKED — the worker tests mock this module wholesale, which
// once hid a real crash on the cross-package path (validator base58 →
// PublicKey → shared leaf fold). These tests run it for real.
// (Wire-format parsing tests live in pulsar-chain-client/src/parser.test.ts.)
import { validatorSetHash, resolveValidatorSetForRoot } from "../validatorSet.js";
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

describe("resolveValidatorSetForRoot with VALIDATOR_SET_OVERRIDE", () => {
    const validators = [1n, 2n, 3n].map((i) => ({
        minaPublicKey: PrivateKey.fromBigInt(i).toPublicKey().toBase58(),
        power: "1",
    }));
    const root = validatorSetHash(validators);

    afterEach(() => {
        envMock.VALIDATOR_SET_OVERRIDE = undefined;
        envMock.PULSAR_GRPC_ENDPOINT = undefined;
    });

    it("returns the override set when it reproduces the root, without gRPC", async () => {
        envMock.VALIDATOR_SET_OVERRIDE = validators;
        // No PULSAR_GRPC_ENDPOINT: reaching the gRPC path would throw.
        await expect(resolveValidatorSetForRoot(root, 1)).resolves.toEqual(
            validators,
        );
    });

    it("rejects an override that does not reproduce the root", async () => {
        envMock.VALIDATOR_SET_OVERRIDE = validators.slice(0, 2);
        await expect(
            resolveValidatorSetForRoot("12345", 1),
        ).rejects.toThrow(/override/);
    });
});
