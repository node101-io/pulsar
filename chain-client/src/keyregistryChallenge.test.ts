import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { keySigningChallenge } from "./keyregistryChallenge.js";
import { actorTypeFromJSON } from "./generated-web/pulsarchain/keyregistry/v1/actor_type.js";
import { keySigningOperationFromJSON } from "./generated-web/pulsarchain/keyregistry/v1/key_signing_operation.js";

// The chain publishes these vectors precisely so a non-Go client can prove it
// derives the same field element (pulsar-chain,
// x/keyregistry/types/signing_test.go reads the same file). Drift here is
// invisible until a wallet signature is rejected on chain, so the vectors are
// read from the submodule rather than copied — a submodule bump that changes
// the derivation fails this test instead of the next user's registration.
type Vector = {
    name: string;
    chain_id: string;
    operation: string;
    actor_type: string;
    cosmos_public_key_hex: string;
    current_mina_public_key_base64: string;
    new_mina_public_key_base64: string;
    new_key_version: number;
    challenge_decimal: string;
    challenge_base64: string;
};

const VECTORS_PATH =
    "../../pulsar-chain/x/keyregistry/types/testdata/key_signing_vectors.json";

const load = (): Vector[] => {
    let raw: string;
    try {
        raw = readFileSync(
            fileURLToPath(new URL(VECTORS_PATH, import.meta.url)),
            "utf8",
        );
    } catch {
        throw new Error(
            "pulsar-chain submodule missing — run 'git submodule update --init'",
        );
    }
    return JSON.parse(raw) as Vector[];
};

const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const fromBase64 = (base64: string) =>
    Uint8Array.from(Buffer.from(base64, "base64"));

describe("keySigningChallenge", () => {
    const vectors = load();

    it("covers every actor and operation the chain vectors define", () => {
        expect(vectors.map((vector) => vector.name)).toEqual([
            "register_user",
            "update_user",
            "register_validator",
            "update_validator",
        ]);
    });

    it.each(vectors)("matches the chain on $name", async (vector) => {
        const challenge = await keySigningChallenge({
            chainId: vector.chain_id,
            operation: keySigningOperationFromJSON(vector.operation),
            actorType: actorTypeFromJSON(vector.actor_type),
            cosmosPublicKey: fromHex(vector.cosmos_public_key_hex),
            currentMinaPublicKey: fromBase64(
                vector.current_mina_public_key_base64,
            ),
            newMinaPublicKey: fromBase64(vector.new_mina_public_key_base64),
            newKeyVersion: vector.new_key_version,
        });

        expect(challenge.toString()).toBe(vector.challenge_decimal);
    });

    // Query/GetKeySigningChallenge answers with these same bytes, and a client
    // that derives the challenge itself has to compare the two. Big-endian, so
    // reading them the other way round silently never matches.
    it.each(vectors)("serialises $name big-endian in challenge_bytes", (vector) => {
        const bigEndian = [...fromBase64(vector.challenge_base64)].reduce(
            (value, byte) => (value << 8n) | BigInt(byte),
            0n,
        );

        expect(bigEndian.toString()).toBe(vector.challenge_decimal);
    });
});

describe("keySigningChallenge input validation", () => {
    const userCosmosKey = fromHex(
        "028e23b60777010732ad6bc2607f5ee5624fbba62ad284bc1300852cf90b2d94b0",
    );
    const minaKey = fromBase64("rMvdD37uiZopL5F0Sb8TSREzLwNyjUK35V8FWM4DA7o=");
    const otherMinaKey = fromBase64(
        "9cbJr5Q1q4xz+CcvADf4JaheDlk8mxb9z5/pWZqeJYI=",
    );
    const register = {
        chainId: "pulsar-test-1",
        operation: keySigningOperationFromJSON("KEY_SIGNING_OPERATION_REGISTER"),
        actorType: actorTypeFromJSON("ACTOR_TYPE_USER"),
        cosmosPublicKey: userCosmosKey,
        newMinaPublicKey: minaKey,
    };

    // Each of these would otherwise produce a well-formed field element that
    // the chain refuses, after the user has already approved the signature.
    it("rejects an empty chain ID", async () => {
        await expect(
            keySigningChallenge({ ...register, chainId: "" }),
        ).rejects.toThrow(/chain ID/);
    });

    it("rejects a validator-length key for a user", async () => {
        await expect(
            keySigningChallenge({
                ...register,
                cosmosPublicKey: userCosmosKey.slice(1),
            }),
        ).rejects.toThrow(/33 bytes/);
    });

    it("rejects a registration that carries a current key", async () => {
        await expect(
            keySigningChallenge({
                ...register,
                currentMinaPublicKey: otherMinaKey,
            }),
        ).rejects.toThrow(/empty current key/);
    });

    it("rejects an update at version zero", async () => {
        await expect(
            keySigningChallenge({
                ...register,
                operation: keySigningOperationFromJSON(
                    "KEY_SIGNING_OPERATION_UPDATE",
                ),
                currentMinaPublicKey: otherMinaKey,
                newKeyVersion: 0,
            }),
        ).rejects.toThrow(/version must be positive/);
    });

    it("rejects an update that does not change the key", async () => {
        await expect(
            keySigningChallenge({
                ...register,
                operation: keySigningOperationFromJSON(
                    "KEY_SIGNING_OPERATION_UPDATE",
                ),
                currentMinaPublicKey: minaKey,
                newKeyVersion: 1,
            }),
        ).rejects.toThrow(/unchanged/);
    });
});
