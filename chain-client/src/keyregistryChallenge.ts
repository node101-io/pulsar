// The field element a Mina wallet signs to authorize a key-registry state
// transition. This is the client half of the chain's
// types.BuildKeySigningChallenge (pulsar-chain,
// x/keyregistry/types/signing.go) and MUST stay byte-identical to it — the
// only symptom of drift is a rejected registration with an opaque "invalid
// signature", so keyregistryChallenge.test.ts pins this to the chain's own
// cross-language vectors.
//
// o1js is imported lazily on purpose: this module is reachable from the
// browser entry (src/messages.ts), and a static import would drag the whole
// prover runtime into a bundle that only wanted to build a transaction.
import { ActorType } from "./generated-web/pulsarchain/keyregistry/v1/actor_type.js";
import { KeySigningOperation } from "./generated-web/pulsarchain/keyregistry/v1/key_signing_operation.js";

export { ActorType, KeySigningOperation, keySigningChallenge };
export type { KeySigningChallengeInput };

// A secp256k1 compressed key for users, an ed25519 consensus key for
// validators — the chain rejects any other length before it even hashes
// (ValidateUserCosmosPublicKey / ValidateValidatorCosmosPublicKey).
const USER_COSMOS_PUBLIC_KEY_BYTES = 33;
const VALIDATOR_COSMOS_PUBLIC_KEY_BYTES = 32;
// x coordinate plus the odd-y flag in the top bit, as the chain stores it.
const MINA_PUBLIC_KEY_BYTES = 32;

// First byte of the hashed payload. Bump only in lockstep with the chain's
// signingFormatVersion; the prefixes below carry the same "v1".
const SIGNING_FORMAT_VERSION = 1;

type KeySigningChallengeInput = {
    /** The chain the proof is valid on — a signature does not travel to another. */
    chainId: string;
    operation: KeySigningOperation;
    actorType: ActorType;
    /** The actor's stable key: secp256k1 for a user, ed25519 consensus for a validator. */
    cosmosPublicKey: Uint8Array;
    /** The Mina key being replaced. Empty on registration. */
    currentMinaPublicKey?: Uint8Array;
    newMinaPublicKey: Uint8Array;
    /** 0 on registration, the stored version + 1 on an update. */
    newKeyVersion?: number | bigint;
};

/**
 * The challenge for one key-registry transition, as a decimal field element.
 *
 * Pass it to a wallet's `signFields` — the chain verifies a Schnorr field
 * signature over exactly this element, not a message signature.
 *
 * Every binding in the input is part of the hash, so a proof cannot be
 * replayed onto another chain, another actor, another Mina key, or an older
 * key version.
 */
async function keySigningChallenge(
    input: KeySigningChallengeInput,
): Promise<bigint> {
    const prefix = validate(input);
    const { Encoding, Poseidon } = await import("o1js");

    return Poseidon.hashWithPrefix(
        prefix,
        Encoding.bytesToFields(challengePayload(input)),
    ).toBigInt();
}

/**
 * The pre-image the chain hashes: a version byte, four length-prefixed byte
 * strings, then the key version. Lengths are 4-byte big-endian and the
 * version is 8-byte big-endian, matching binary.BigEndian on the Go side.
 */
function challengePayload(input: KeySigningChallengeInput): Uint8Array {
    const chainId = new TextEncoder().encode(input.chainId);
    const currentMinaPublicKey = input.currentMinaPublicKey ?? new Uint8Array();

    const parts = [
        Uint8Array.of(SIGNING_FORMAT_VERSION),
        ...lengthPrefixed(chainId),
        ...lengthPrefixed(input.cosmosPublicKey),
        ...lengthPrefixed(currentMinaPublicKey),
        ...lengthPrefixed(input.newMinaPublicKey),
        bigEndian(BigInt(input.newKeyVersion ?? 0), 8),
    ];

    const payload = new Uint8Array(
        parts.reduce((total, part) => total + part.length, 0),
    );
    let offset = 0;
    for (const part of parts) {
        payload.set(part, offset);
        offset += part.length;
    }
    return payload;
}

function lengthPrefixed(value: Uint8Array): Uint8Array[] {
    return [bigEndian(BigInt(value.length), 4), value];
}

function bigEndian(value: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let rest = value;
    for (let i = length - 1; i >= 0; i--) {
        bytes[i] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return bytes;
}

/**
 * The chain's validateKeySigningChallengeInput, ported. Deriving a challenge
 * from inconsistent input would otherwise succeed here and fail at broadcast,
 * after the user has already signed something meaningless.
 *
 * Returns the domain-separation prefix for this (actor, operation) pair.
 */
function validate(input: KeySigningChallengeInput): string {
    if (!input.chainId) throw new Error("chain ID is empty");

    if (
        input.actorType !== ActorType.ACTOR_TYPE_USER &&
        input.actorType !== ActorType.ACTOR_TYPE_VALIDATOR
    ) {
        throw new Error(`invalid actor type: ${input.actorType}`);
    }
    const isUser = input.actorType === ActorType.ACTOR_TYPE_USER;

    const cosmosKeyBytes = isUser
        ? USER_COSMOS_PUBLIC_KEY_BYTES
        : VALIDATOR_COSMOS_PUBLIC_KEY_BYTES;
    if (input.cosmosPublicKey.length !== cosmosKeyBytes) {
        throw new Error(
            `cosmos public key must be ${cosmosKeyBytes} bytes, got ${input.cosmosPublicKey.length}`,
        );
    }
    // Length only: the chain also checks the point is on the curve, which
    // costs a decompression the caller's wallet has already done.
    if (input.newMinaPublicKey.length !== MINA_PUBLIC_KEY_BYTES) {
        throw new Error(
            `new mina public key must be ${MINA_PUBLIC_KEY_BYTES} bytes, got ${input.newMinaPublicKey.length}`,
        );
    }

    const currentMinaPublicKey = input.currentMinaPublicKey ?? new Uint8Array();
    const newKeyVersion = BigInt(input.newKeyVersion ?? 0);

    switch (input.operation) {
        case KeySigningOperation.KEY_SIGNING_OPERATION_REGISTER:
            if (currentMinaPublicKey.length !== 0 || newKeyVersion !== 0n) {
                throw new Error(
                    "registration requires an empty current key and version zero",
                );
            }
            return isUser ? "pulsar-kr-user-reg-v1" : "pulsar-kr-val-reg-v1";

        case KeySigningOperation.KEY_SIGNING_OPERATION_UPDATE:
            if (currentMinaPublicKey.length !== MINA_PUBLIC_KEY_BYTES) {
                throw new Error(
                    `current mina public key must be ${MINA_PUBLIC_KEY_BYTES} bytes, got ${currentMinaPublicKey.length}`,
                );
            }
            if (newKeyVersion === 0n) {
                throw new Error("update version must be positive");
            }
            if (equalBytes(currentMinaPublicKey, input.newMinaPublicKey)) {
                throw new Error("new mina public key is unchanged");
            }
            return isUser ? "pulsar-kr-user-upd-v1" : "pulsar-kr-val-upd-v1";

        default:
            throw new Error(`invalid signing operation: ${input.operation}`);
    }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    return (
        left.length === right.length &&
        left.every((byte, index) => byte === right[index])
    );
}
