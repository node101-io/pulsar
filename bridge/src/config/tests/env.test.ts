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
