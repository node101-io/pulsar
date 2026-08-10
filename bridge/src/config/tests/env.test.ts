import { readFileSync } from "fs";

import { describe, it, expect } from "vitest";
import { validatorSetOverrideSchema } from "../env.js";

// The env module itself is exercised implicitly by every suite (it validates
// at import); these tests pin the one non-trivial schema.
describe("validatorSetOverrideSchema", () => {
    it("parses a valid JSON validator set into objects", () => {
        const parsed = validatorSetOverrideSchema.parse(
            '[{"minaPublicKey":"B62qTest","power":"1"}]',
        );
        expect(parsed).toEqual([{ minaPublicKey: "B62qTest", power: "1" }]);
    });

    it("rejects invalid JSON with a clear message", () => {
        const result = validatorSetOverrideSchema.safeParse("not-json{");
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error?.issues)).toMatch(/not valid JSON/);
    });

    it("rejects a wrong shape instead of crashing later in base58 parsing", () => {
        const result = validatorSetOverrideSchema.safeParse(
            '[{"publicKey":"wrong-field-name","power":1}]',
        );
        expect(result.success).toBe(false);
    });
});

// .env.example is what a developer copies. PULSAR_GRPC_ENDPOINT is required
// (the single chain dependency: verdicts, signed roots and the validator set
// all travel over it), so the example must ship it — otherwise a copied file
// fails the boot-time gate with no hint which row went missing.
describe(".env.example", () => {
    const example = Object.fromEntries(
        readFileSync(new URL("../../../.env.example", import.meta.url), "utf-8")
            .split("\n")
            .map((line) => line.replace(/\s+#.*$/, "").trim())
            .filter((line) => line && !line.startsWith("#"))
            .map((line) => {
                const at = line.indexOf("=");
                return [line.slice(0, at), line.slice(at + 1)];
            }),
    );

    it("ships the required Pulsar gRPC endpoint", () => {
        expect(example.PULSAR_GRPC_ENDPOINT).toBeTruthy();
    });

    it("carries no row for the deleted REST transport", () => {
        // Composed so the dead-model sweep (src/tests/deadModel.test.ts),
        // which forbids this token anywhere in bridge source, does not flag
        // the very assertion that keeps it out of .env.example.
        expect(example).not.toHaveProperty(
            ["PULSAR", "REST", "ENDPOINT"].join("_"),
        );
    });

    it("carries no row for the deleted signature-request configuration", () => {
        expect(example).not.toHaveProperty("PULSAR_VALIDATOR_ENDPOINTS");
        expect(example).not.toHaveProperty("PULSAR_VALID_ACTIONS_MODE");
    });
});
