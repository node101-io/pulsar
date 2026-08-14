import { describe, it, expect } from "vitest";

import { txSigningChallenge } from "./txSigningChallenge.js";

const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

// Both vectors are literals the chain also pins in its own tests (they live in
// Go source, not a published testdata file, so they are copied rather than
// read from the submodule). Each side's test guards its copy; a derivation
// change that updates one without the other fails here, not in a wallet.
describe("txSigningChallenge", () => {
    // pulsar-chain app/ante/tx_signing_challenge_test.go,
    // TestBuildTxSigningChallengeVector — the chain's wire-format pin,
    // asserted there as big-endian challenge bytes.
    it("matches the chain's golden vector", async () => {
        const challenge = await txSigningChallenge(
            new TextEncoder().encode("pulsar-tx-vector-01"),
        );

        expect(challenge.toString(16)).toBe(
            "185cf93846576559d5abe9e6c8b5d637940727c9516d1f346a775fe57d897cff",
        );
    });

    // pulsar-chain app/ante/mina_verifier_test.go, the auroFixture constants:
    // real SIGN_MODE_DIRECT sign bytes whose challenge a real Auro wallet
    // signed, and whose signature the chain's verifier accepts end to end.
    // Matching this decimal means the string this module hands to signFields
    // is the one the chain will verify against.
    it("matches the challenge a real Auro wallet signed", async () => {
        const signBytes = fromHex(
            "0aa1010a8a010a1c2f636f736d6f732e62616e6b2e763162657461312e4d736753656e64126a0a2d636f736d6f73317274397134766675676a747a7277366b736e726c79706a7a74766a37306b7171336c367a6873122d636f736d6f733177656a687936747864396a687974746a7634336b6a75726676346838677466337472687368781a0a0a05706d696e6112013112126d696e612d76657269666965722d7465737412640a500a460a1f2f636f736d6f732e63727970746f2e736563703235366b312e5075624b657912230a210290dac513c0aa1d28ff3f84edbd9ea2a3a1b9b03321f322a9c3d63d0616e1efba12040a020801180412100a0a0a05706d696e6112013110c09a0c1a096d79746573746e65742007",
        );

        expect((await txSigningChallenge(signBytes)).toString()).toBe(
            "12257257702349105346219296062496834325698503218878437959425980317767459379361",
        );
    });

    it("separates payloads", async () => {
        const first = await txSigningChallenge(
            new TextEncoder().encode("payload-a"),
        );
        const second = await txSigningChallenge(
            new TextEncoder().encode("payload-b"),
        );

        expect(first).not.toBe(second);
    });

    // A challenge over nothing authorizes nothing; the chain refuses it too.
    it("rejects empty sign bytes", async () => {
        await expect(txSigningChallenge(new Uint8Array())).rejects.toThrow(
            /empty sign bytes/,
        );
    });
});
