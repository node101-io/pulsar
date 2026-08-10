import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Cutover sweep guard: the /getSignature
// protocol, the ValidateReduce circuit and the actionListHash contract slot
// were DELETED — signatures now come from on-demand vote-extension reads
// (services/pulsar/voteExtensions.ts) and the contract commits approvalCursor.
// Nothing may reference them again, not even a mock or a comment: a stale
// mention is either dead code the sweep missed or documentation that
// misdescribes the current data flow. This file names the tokens on purpose
// and excludes itself from the scan.
const FORBIDDEN_TOKENS = [
    "getSignature",
    "requestSignatures",
    "PULSAR_REST_ENDPOINT",
    "restGet",
    "ValidateReduce",
    "actionListHash",
];

const SELF = join("src", "tests", "deadModel.test.ts");

function listTsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listTsFiles(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

describe("dead-model sweep", () => {
    it("no bridge source references the deleted signature-request model", () => {
        // vitest runs from the bridge package root, like vitest.config.ts
        const offenders = listTsFiles("src")
            .filter((path) => path !== SELF)
            .flatMap((path) => {
                const content = readFileSync(path, "utf-8");
                return FORBIDDEN_TOKENS.filter((token) =>
                    content.includes(token),
                ).map((token) => `${path}: ${token}`);
            });

        expect(offenders).toEqual([]);
    });
});
