import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import type { Metadata } from "@grpc/grpc-js";
import { Field, PublicKey } from "o1js";

import {
    VOTE_EXT_PERSISTENCE_LAG,
    fetchSignedVoteExtension,
    fetchVoteExtBody,
    fetchVoteExtSignatures,
} from "./voteExtensions.js";

// The fixture is the tranche-1 chain-generated vector file (signed via the
// real abci.SecondaryKey.SignVoteExtBody) — read from contracts rather than
// copied, so the two packages can never pin different bytes.
const fixture = JSON.parse(
    readFileSync(
        new URL(
            "../../contracts/src/test/fixtures/voteExtBody.vectors.json",
            import.meta.url,
        ),
        "utf8",
    ),
) as {
    vectors: Array<{
        description: string;
        wire: {
            nextValidatorSetHashBase64: string;
            appHashBase64: string;
            currentBlockHeight: string;
            actionsReducedRootBase64: string;
        };
        fields: {
            nextValidatorSetHash: string;
            stateRootHi: string;
            stateRootLo: string;
            currentBlockHeight: string;
            actionsReducedRoot: string;
        };
    }>;
    quorum: {
        wire: {
            nextValidatorSetHashBase64: string;
            appHashBase64: string;
            currentBlockHeight: string;
            actionsReducedRootBase64: string;
        };
        fields: { currentBlockHeight: string };
        validators: Array<{
            publicKeyBase58: string;
            signature: { r: string; s: string };
        }>;
    };
};

type WireBody = (typeof fixture.vectors)[number]["wire"];

function protoBody(wire: WireBody) {
    return {
        next_validator_set_hash: Uint8Array.from(
            Buffer.from(wire.nextValidatorSetHashBase64, "base64"),
        ),
        current_state_root: Uint8Array.from(
            Buffer.from(wire.appHashBase64, "base64"),
        ),
        current_block_height: wire.currentBlockHeight,
        actions_reduced_root: Uint8Array.from(
            Buffer.from(wire.actionsReducedRootBase64, "base64"),
        ),
    };
}

// mina-signer-go wire format (parser.ts): 32-byte little-endian halves.
function leBytes32(value: bigint): Buffer {
    const buf = Buffer.alloc(32);
    for (let i = 0; i < 32; i += 1) {
        buf[i] = Number(value & 0xffn);
        value >>= 8n;
    }
    return buf;
}

function signatureWire(sig: { r: string; s: string }): Uint8Array {
    return Uint8Array.from(
        Buffer.concat([leBytes32(BigInt(sig.r)), leBytes32(BigInt(sig.s))]),
    );
}

// 32-byte LE compressed pubkey: buf[31] MSB = isOdd, remaining bits = x.
function pubkeyWire(base58: string): Uint8Array {
    const pk = PublicKey.fromBase58(base58);
    const buf = leBytes32(pk.x.toBigInt());
    if (pk.isOdd.toBoolean()) buf[31] |= 0x80;
    return Uint8Array.from(buf);
}

function abciClientServing(
    body: ReturnType<typeof protoBody> | undefined,
    requests?: Array<{ vote_extension_height?: string }>,
) {
    return {
        voteExtBodyByHeight: (
            req: { vote_extension_height?: string },
            cb: (err: null, res: { vote_ext_body?: typeof body }) => void,
        ) => {
            requests?.push(req);
            cb(null, { vote_ext_body: body });
        },
    };
}

function vpClientServing(
    res: {
        persisted_vote_extensions_block_height?: string;
        vote_extensions?: Array<{
            mina_public_key?: Uint8Array;
            vote_extension?: Uint8Array;
        }>;
    },
    metadatas?: Metadata[],
) {
    return {
        voteExtensions: (
            _req: object,
            metadata: Metadata,
            cb: (err: null, r: typeof res) => void,
        ) => {
            metadatas?.push(metadata);
            cb(null, res);
        },
    };
}

describe("fetchVoteExtBody", () => {
    for (const vector of fixture.vectors) {
        it(`decodes the chain-signed wire body (${vector.description})`, async () => {
            const requests: Array<{ vote_extension_height?: string }> = [];
            const body = await fetchVoteExtBody(
                abciClientServing(protoBody(vector.wire), requests),
                7,
            );

            // Byte->field conventions pinned digit-for-digit against
            // VoteExtBody.fromWire's own fixture expectations.
            expect(body).toEqual(vector.fields);
            // Bodies are keyed by the height where the extension was
            // PRODUCED = signed height + 2.
            expect(requests).toEqual([{ vote_extension_height: "9" }]);
        });
    }

    it("rejects an app hash that is not 32 bytes", async () => {
        const wire = protoBody(fixture.vectors[0].wire);
        wire.current_state_root = wire.current_state_root.subarray(0, 31);
        await expect(
            fetchVoteExtBody(abciClientServing(wire), 7),
        ).rejects.toThrow("32 bytes");
    });

    it("rejects a non-canonical root (>= field modulus)", async () => {
        const wire = protoBody(fixture.vectors[0].wire);
        const modBytes = Buffer.alloc(32);
        let order = Field.ORDER;
        for (let i = 31; i >= 0; i -= 1) {
            modBytes[i] = Number(order & 0xffn);
            order >>= 8n;
        }
        wire.next_validator_set_hash = Uint8Array.from(modBytes);
        await expect(
            fetchVoteExtBody(abciClientServing(wire), 7),
        ).rejects.toThrow("field modulus");
    });

    it("rejects an empty response", async () => {
        await expect(
            fetchVoteExtBody(abciClientServing(undefined), 7),
        ).rejects.toThrow("empty VoteExtBodyByHeight");
    });
});

describe("fetchVoteExtSignatures", () => {
    const height = Number(fixture.quorum.fields.currentBlockHeight);

    it("pins the read to signedHeight + LAG and decodes every signer", async () => {
        const metadatas: Metadata[] = [];
        const signatures = await fetchVoteExtSignatures(
            vpClientServing(
                {
                    persisted_vote_extensions_block_height: String(height),
                    vote_extensions: fixture.quorum.validators.map((v) => ({
                        mina_public_key: pubkeyWire(v.publicKeyBase58),
                        vote_extension: signatureWire(v.signature),
                    })),
                },
                metadatas,
            ),
            height,
        );

        expect(metadatas[0]?.get("x-cosmos-block-height")).toEqual([
            String(height + VOTE_EXT_PERSISTENCE_LAG),
        ]);
        // The LE wire round-trips through parser.ts back to the exact
        // decimal (r, s) the chain's Go signer recorded.
        expect(signatures).toEqual(
            fixture.quorum.validators.map((v) => ({
                minaPublicKey: v.publicKeyBase58,
                r: v.signature.r,
                s: v.signature.s,
            })),
        );
    });

    it("returns [] when the persisted votes belong to another height", async () => {
        const signatures = await fetchVoteExtSignatures(
            vpClientServing({
                persisted_vote_extensions_block_height: String(height - 1),
                vote_extensions: fixture.quorum.validators.map((v) => ({
                    mina_public_key: pubkeyWire(v.publicKeyBase58),
                    vote_extension: signatureWire(v.signature),
                })),
            }),
            height,
        );
        expect(signatures).toEqual([]);
    });
});

describe("fetchSignedVoteExtension", () => {
    const height = Number(fixture.quorum.fields.currentBlockHeight);

    it("pairs the body with its signatures under one cosmosHeight", async () => {
        const record = await fetchSignedVoteExtension(
            abciClientServing(protoBody(fixture.quorum.wire)),
            vpClientServing({
                persisted_vote_extensions_block_height: String(height),
                vote_extensions: [
                    {
                        mina_public_key: pubkeyWire(
                            fixture.quorum.validators[0].publicKeyBase58,
                        ),
                        vote_extension: signatureWire(
                            fixture.quorum.validators[0].signature,
                        ),
                    },
                ],
            }),
            height,
        );

        expect(record.cosmosHeight).toBe(height);
        expect(record.body.currentBlockHeight).toBe(String(height));
        expect(record.signatures).toHaveLength(1);
    });

    it("throws when the body's height does not match the requested one", async () => {
        await expect(
            fetchSignedVoteExtension(
                abciClientServing(protoBody(fixture.quorum.wire)),
                vpClientServing({
                    persisted_vote_extensions_block_height: String(height + 1),
                }),
                height + 1,
            ),
        ).rejects.toThrow("height convention drifted");
    });
});
