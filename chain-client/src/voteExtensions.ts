import { Metadata } from "@grpc/grpc-js";
import { Field, Signature } from "o1js";

import { grpcUnary, protoBytesToBuffer } from "./transport.js";
import type {
    AbciQueryClient,
    QueryVoteExtBodyByHeightResponse,
    QueryVoteExtensionsResponse,
    VotePersistenceClient,
} from "./transport.js";
import { decodeMinaSignature, parseMinaPubkeyFromBytes } from "./parser.js";

// Vote-extension ingest, shared by the bridge and the prover so the height
// arithmetic and byte->field conventions exist exactly once.
//
// Height conventions, all relative to the SIGNED state height H — the cosmos
// block whose state the quorum actually signed:
// - ExtendVote(N) signs the transition out of state N-2, and the body records
//   CurrentBlockHeight = N-2 (pulsar-chain abci/validator_set.go:164-207), so
//   the body for H is served by VoteExtBodyByHeight(H + 2).
// - The extensions of N are persisted by the PreBlocker of N+1
//   (abci/pre_blocker.go), i.e. in the committed state of N+1 = H + 3 — one
//   block later they are cleared, which is why callers must archive as they
//   poll. A height-pinned VotePersistence.VoteExtensions read at H + 3
//   (x/votepersistence/keeper/query_vote_extensions.go) therefore returns the
//   signatures over H's body, self-identified by
//   persisted_vote_extensions_block_height = H.
export const VOTE_EXT_PERSISTENCE_LAG = 3;

/**
 * The signed body decoded to decimal field-element strings. Field-for-field
 * the input of pulsar-contracts VoteExtBody (types/voteExtBody.ts) — Field()
 * over these strings reproduces the struct whose hash() the signatures below
 * verify against.
 */
export interface VoteExtBodyFields {
    nextValidatorSetHash: string;
    stateRootHi: string;
    stateRootLo: string;
    currentBlockHeight: string;
    actionsReducedRoot: string;
}

/** One validator's signature over the body hash, decimal (r, s). */
export interface VoteExtSignature {
    /** Mina PublicKey base58 — the join key against the validator set. */
    minaPublicKey: string;
    r: string;
    s: string;
}

export interface SignedVoteExtRecord {
    /** Signed state height H — equals body.currentBlockHeight, asserted. */
    cosmosHeight: number;
    body: VoteExtBodyFields;
    /** Empty when the one-block persistence window for H was missed. */
    signatures: VoteExtSignature[];
}

// Byte->field decode conventions are pinned to VoteExtBody.fromWire in
// contracts/src/types/voteExtBody.ts:94-113 and MUST NOT drift from it:
// - roots are strict big-endian field bytes, values >= p are a malformed
//   body (voteExtBody.ts:107,:111 via fieldFromBytesBE :125-131);
// - the 32-byte app hash is split 16/16 and each half BE-decoded with the
//   chain's reduce semantics (voteExtBody.ts:108-109 via
//   fieldFromBytesBEReduce :134-136) — a 128-bit half never reaches p, the
//   reduction exists only to mirror the chain.
function bytesToBigIntBE(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    return value;
}

function decStrFromBytesBE(bytes: Uint8Array, what: string): string {
    const value = bytesToBigIntBE(bytes);
    if (value >= Field.ORDER) {
        throw new Error(`${what} exceeds the field modulus`);
    }
    return value.toString();
}

function decStrFromBytesBEReduce(bytes: Uint8Array): string {
    return (bytesToBigIntBE(bytes) % Field.ORDER).toString();
}

/**
 * Fetch and decode the vote-extension body signed over state height
 * `signedHeight` (served by VoteExtBodyByHeight at signedHeight + 2).
 * `currentBlockHeight` is returned as the chain served it — the pairing
 * assertion against `signedHeight` lives in fetchSignedVoteExtension, next
 * to the signatures it protects.
 */
export async function fetchVoteExtBody(
    abciClient: Pick<AbciQueryClient, "voteExtBodyByHeight">,
    signedHeight: number,
): Promise<VoteExtBodyFields> {
    const res = await grpcUnary<QueryVoteExtBodyByHeightResponse>((cb) =>
        abciClient.voteExtBodyByHeight(
            { vote_extension_height: String(signedHeight + 2) },
            cb,
        ),
    );

    const body = res.vote_ext_body;
    if (!body) {
        throw new Error(
            `empty VoteExtBodyByHeight response for signed height ${signedHeight}`,
        );
    }

    const appHash = protoBytesToBuffer(body.current_state_root);
    if (appHash.length !== 32) {
        throw new Error(
            `currentStateRoot must be 32 bytes, got ${appHash.length}`,
        );
    }

    return {
        nextValidatorSetHash: decStrFromBytesBE(
            protoBytesToBuffer(body.next_validator_set_hash),
            "next_validator_set_hash",
        ),
        stateRootHi: decStrFromBytesBEReduce(appHash.subarray(0, 16)),
        stateRootLo: decStrFromBytesBEReduce(appHash.subarray(16, 32)),
        currentBlockHeight: String(body.current_block_height ?? "0"),
        actionsReducedRoot: decStrFromBytesBE(
            protoBytesToBuffer(body.actions_reduced_root),
            "actions_reduced_root",
        ),
    };
}

/**
 * Fetch the persisted signatures over the body of state height
 * `signedHeight`, via a read pinned to signedHeight + LAG. Returns [] when
 * that state holds another height's votes (window missed) — the caller
 * decides whether a signatureless height matters.
 */
export async function fetchVoteExtSignatures(
    vpClient: Pick<VotePersistenceClient, "voteExtensions">,
    signedHeight: number,
): Promise<VoteExtSignature[]> {
    const metadata = new Metadata();
    metadata.add(
        "x-cosmos-block-height",
        String(signedHeight + VOTE_EXT_PERSISTENCE_LAG),
    );

    const res = await grpcUnary<QueryVoteExtensionsResponse>((cb) =>
        vpClient.voteExtensions({}, metadata, cb),
    );

    if (Number(res.persisted_vote_extensions_block_height) !== signedHeight) {
        return [];
    }

    return (res.vote_extensions ?? []).map((v) => {
        // The 64-byte wire format is parser.ts's contract; round-trip
        // through base58 rather than re-reading the halves here.
        const signature = Signature.fromBase58(
            decodeMinaSignature(protoBytesToBuffer(v.vote_extension)),
        );
        return {
            minaPublicKey: parseMinaPubkeyFromBytes(
                protoBytesToBuffer(v.mina_public_key),
            ),
            r: signature.r.toString(),
            s: signature.s.toBigInt().toString(),
        };
    });
}

/**
 * The full ingest unit for one signed state height: body plus the
 * signatures over it, with the pairing asserted — a body whose
 * currentBlockHeight is not the requested height would silently attach
 * signatures to the wrong message, so it throws instead.
 */
export async function fetchSignedVoteExtension(
    abciClient: Pick<AbciQueryClient, "voteExtBodyByHeight">,
    vpClient: Pick<VotePersistenceClient, "voteExtensions">,
    signedHeight: number,
): Promise<SignedVoteExtRecord> {
    const [body, signatures] = await Promise.all([
        fetchVoteExtBody(abciClient, signedHeight),
        fetchVoteExtSignatures(vpClient, signedHeight),
    ]);

    if (body.currentBlockHeight !== String(signedHeight)) {
        throw new Error(
            `VoteExtBodyByHeight(${signedHeight + 2}) returned a body for ` +
                `state height ${body.currentBlockHeight}, expected ` +
                `${signedHeight} — the chain's height convention drifted`,
        );
    }

    return { cosmosHeight: signedHeight, body, signatures };
}
