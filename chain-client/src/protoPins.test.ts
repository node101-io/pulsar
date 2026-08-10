import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

// The generation inputs are the wire spec and src/generated is a gitignored
// build artifact, so a wrong input would let a regen reshape the codecs
// without appearing in any diff. Everything must be pinned by the
// pulsar-chain submodule gitlink: its protos directly, the cosmos-sdk BSR
// module by matching the commit in its committed buf.lock. Guarded here
// because buf itself cannot fail on it.
const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("buf.gen.yaml inputs", () => {
    const bufGen = read("../buf.gen.yaml");

    it("reads pulsar-chain protos from the submodule, not a remote", () => {
        const directories = [
            ...bufGen.matchAll(/^\s*-\s*directory:\s*(\S+)/gm),
        ].map(([, source]) => source);
        expect(directories).toEqual(["../pulsar-chain"]);
    });

    it("pins cosmos-sdk to the exact commit in the submodule's buf.lock", () => {
        const modules = [...bufGen.matchAll(/^\s*-\s*module:\s*(\S+)/gm)].map(
            ([, source]) => source,
        );
        // The tendermint query service is the only reason to reach past the
        // submodule; any new BSR input needs this same buf.lock treatment.
        expect(modules).toHaveLength(1);
        const pinned = modules[0]!.match(
            /^buf\.build\/cosmos\/cosmos-sdk:([0-9a-f]{32})$/,
        )?.[1];
        expect(pinned, "cosmos-sdk input must carry an immutable commit").toBeDefined();

        let lock: string;
        try {
            lock = read("../../pulsar-chain/buf.lock");
        } catch {
            return expect.fail(
                "pulsar-chain submodule missing — run 'git submodule update --init'",
            );
        }
        const chainPin = lock.match(
            /^  - name: buf\.build\/cosmos\/cosmos-sdk\n\s+commit: ([0-9a-f]{32})$/m,
        )?.[1];
        expect(chainPin, "cosmos-sdk dep not found in pulsar-chain/buf.lock").toBeDefined();
        // The chain encodes its responses with the cosmos-sdk version IT was
        // built against. If this fails after a submodule bump, copy the
        // buf.lock commit into buf.gen.yaml and regenerate.
        expect(pinned).toBe(chainPin);
    });
});
