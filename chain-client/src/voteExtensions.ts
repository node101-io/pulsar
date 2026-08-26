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
//
// So the lag IS the body offset plus one, and that one height serves BOTH
// reads: VoteExtBodyByHeight refuses a vote-ext height that is not strictly
// below the pinned height (abci/query_vote_ext_body_by_height.go), and
// H + OFFSET + 1 is the lowest that clears it. Body and signatures therefore
// come from a single state snapshot by construction, not by coincidence —
// which is what makes the pinned reads below safe to pair.
export const VOTE_EXT_BODY_HEIGHT_OFFSET = 2;
export const VOTE_EXT_PERSISTENCE_LAG = VOTE_EXT_BODY_HEIGHT_OFFSET + 1;

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
    // The chain stores no bodies: VoteExtBodyByHeight recomputes one against
    // whatever state the query lands on, and its actions-root read reaches
    // back only as far as the pruned snapshot window. Unpinned, that is the
    // tip's window, so every body older than a few pushes fails. Pin what
    // fetchVoteExtSignatures pins, so body and signatures come from one
    // snapshot; it is also the lowest height the chain accepts, since the
    // query rejects a vote-ext height not strictly below it.
    const metadata = new Metadata();
    metadata.add(
        "x-cosmos-block-height",
        String(signedHeight + VOTE_EXT_PERSISTENCE_LAG),
    );

    const res = await grpcUnary<QueryVoteExtBodyByHeightResponse>((cb) =>
        abciClient.voteExtBodyByHeight(
            {
                vote_extension_height: String(
                    signedHeight + VOTE_EXT_BODY_HEIGHT_OFFSET,
                ),
            },
            metadata,
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

    // The body self-identifies the state height it describes, so the offset
    // above is checkable rather than assumed: a body for another height would
    // otherwise be consumed as this one's signed message.
    const currentBlockHeight = String(body.current_block_height ?? "0");
    if (currentBlockHeight !== String(signedHeight)) {
        throw new Error(
            `VoteExtBodyByHeight(${
                signedHeight + VOTE_EXT_BODY_HEIGHT_OFFSET
            }) returned a body for ` +
                `state height ${currentBlockHeight}, expected ` +
                `${signedHeight} — the chain's height convention drifted`,
        );
    }

    return {
        nextValidatorSetHash: decStrFromBytesBE(
            protoBytesToBuffer(body.next_validator_set_hash),
            "next_validator_set_hash",
        ),
        stateRootHi: decStrFromBytesBEReduce(appHash.subarray(0, 16)),
        stateRootLo: decStrFromBytesBEReduce(appHash.subarray(16, 32)),
        currentBlockHeight,
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
    // The pairing assert lives in fetchVoteExtBody, which owns the offset it
    // checks; this only has to fetch both halves at the same height.
    const [body, signatures] = await Promise.all([
        fetchVoteExtBody(abciClient, signedHeight),
        fetchVoteExtSignatures(vpClient, signedHeight),
    ]);

    return { cosmosHeight: signedHeight, body, signatures };
}
