import * as grpc from "@grpc/grpc-js";
import { Field } from "o1js";

import { foldApprovalCursor } from "pulsar-contracts/build/src/utils/pulsarActionLeaf.js";
import {
    BridgeQueryClient,
    fetchActionsReducedRoot as grpcFetchActionsReducedRoot,
    fetchLatestActionHashes,
    grpcCredentials,
} from "pulsar-chain-client";

import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

// WIRE SPEC, confirmed against pulsar-chain PR #39 refactor-action head
// 5a1013a (proto/pulsarchain/bridge/v1/query.proto), read
// over gRPC via pulsar-chain-client's generated codecs — the same transport
// and endpoint (PULSAR_GRPC_ENDPOINT) as the validator set and the
// vote-extension reads, so the chain is one dependency, not two:
// - Query/LatestActionHashes {} -> { start_mina_height,
//   latest_fetched_mina_height, action_hashes,
//   action_hashes_cosmos_block_height }. The batch covers the Mina
//   interval (start_mina_height, latest_fetched_mina_height]; the hashes are
//   decimal field elements in append order — under the v2 convention one
//   VERDICT leaf per SCANNED action, approved or not, so the list mirrors the
//   L1 action queue position for position; the cosmos height is the block
//   whose state holds this batch. int64s arrive as strings (forceLong=string).
//   The chain renamed this query from LatestValidActionHashes (P6, landed as
//   5a1013a) because the list was never only the VALID actions — a node still
//   serving the old name answers the new method with UNIMPLEMENTED, which
//   classifyGrpcFault turns into a wire-spec strike, and field-level drift
//   (proto renames keep the tags, so a re-tagged field decodes as EMPTY
//   rather than failing loudly) is what the fold verification below catches:
//   zero leaves cannot fold rootBefore into a root that moved.
// - Query/ActionsReducedRoot {} -> { actions_reduced_root }, a decimal field
//   element (the keeper renders it with mina-signer-go's FieldElement.String).
//   Under the redesigned leaf it is the cumulative approval-cursor fold
//   (prefix "pulsar_bridge_actions_root_v1" — the chain kept the v1 prefix
//   STRING for the reshaped leaf, so our side matches it; see
//   contracts/src/utils/pulsarActionLeaf.ts), the same fold the contract
//   stores a prefix of in its approvalCursor slot.
// - Historical values via the standard Cosmos historical state query header
//   (x-cosmos-block-height metadata, added by pulsar-chain-client). The
//   keepers are contractually NotFound for a pruned version rather than
//   falling back to the latest value, which is what makes a pinned read
//   either exact or an error — never quietly wrong.

// The endpoint contradicts the wire spec above: the node does not serve the
// query (it predates the x/bridge query set), or it answered with a
// missing/renamed field or a value the decoder cannot read. Deterministic —
// the endpoint answers the same way on every retry — so callers must NOT
// treat this as transient: it needs the spec block above adjusted (or the
// node upgraded), not patience.
export class ApprovalWireSpecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApprovalWireSpecError";
    }
}

// A batch's hash list failed fold verification against the on-chain
// actions_reduced_root transition, or the walk back through pushes hit a gap:
// the data is inconsistent, so callers must NOT retry this as transient.
export class ApprovalIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApprovalIntegrityError";
    }
}

// The push covering the contract's approval cursor is out of reach — the node
// refused the height-pinned query (pruning), the cursor predates the chain's
// reachable history (zero-height restart), or the chain has no history at all
// where the cursor says there should be some. Retrying is pointless, and it
// is NOT an integrity failure: the data is unreachable, not wrong. The causes
// need different remedies, so each throw site says which one it hit.
export class ApprovalHistoryPrunedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApprovalHistoryPrunedError";
    }
}

function heightSuffix(atCosmosHeight?: number): string {
    return atCosmosHeight === undefined
        ? ""
        : ` at cosmos height ${atCosmosHeight}`;
}

let _client: BridgeQueryClient | null = null;

function getClient(): BridgeQueryClient {
    if (_client) return _client;
    _client = new BridgeQueryClient(
        env.PULSAR_GRPC_ENDPOINT,
        grpcCredentials(env.PULSAR_GRPC_ENDPOINT),
    );
    return _client;
}

// A gRPC status is the endpoint's own ANSWER, not a network failure, so the
// code decides the taxonomy. Only a node that is down, restarting or shedding
// load heals by itself. Everything else is deterministic and must strike: an
// UNIMPLEMENTED query means this node predates the x/bridge query set, and a
// refused height-pinned read means that version is no longer readable here —
// baseapp answers InvalidArgument for a pruned state version, and both
// keepers are contractually NotFound rather than falling back.
const TRANSIENT_GRPC_CODES: ReadonlySet<grpc.status> = new Set([
    grpc.status.UNAVAILABLE,
    grpc.status.DEADLINE_EXCEEDED,
    grpc.status.RESOURCE_EXHAUSTED,
    grpc.status.ABORTED,
    grpc.status.INTERNAL,
]);

function classifyGrpcFault(
    error: unknown,
    what: string,
    atCosmosHeight?: number,
): Error {
    const code = (error as grpc.ServiceError)?.code;
    const detail =
        error instanceof Error ? error.message : String(error);
    const message =
        `${what}${heightSuffix(atCosmosHeight)} failed with gRPC status ` +
        `${code ?? "unknown"}: ${detail}`;
    if (code === undefined || TRANSIENT_GRPC_CODES.has(code))
        return new Error(message, { cause: error });
    if (
        atCosmosHeight !== undefined &&
        (code === grpc.status.NOT_FOUND ||
            code === grpc.status.INVALID_ARGUMENT)
    )
        return new ApprovalHistoryPrunedError(
            `${message} — this node cannot read state at that height. ` +
                `Retrying cannot recover it: query an archive Pulsar node ` +
                `(no pruning) or reconcile the missing approvals manually. ` +
                `If the SAME query also fails without a height pin, the node ` +
                `does not serve it at all — fix the spec block in ` +
                `actionHashes.ts instead.`,
        );
    return new ApprovalWireSpecError(
        `${message} — this node does not serve the query named in the wire ` +
            `spec at the top of actionHashes.ts (a node older than the ` +
            `x/bridge query set, or a chain without the module).`,
    );
}

// Pallas base field order. o1js Field() silently REDUCES an out-of-range input
// mod p rather than throwing, so an out-of-range wire value would fold as some
// other leaf and resurface as an ApprovalIntegrityError blaming the fold —
// range-check it here, at the boundary where the taxonomy can name it.
const FIELD_MODULUS =
    28948022309329048855892746252171976963363056481941560715954676764349967630337n;

// Leaves and the root share one decoder because the chain renders both with
// mina-signer-go's FieldElement.String(). Decimal is the whole contract: no
// base64 branch, because Buffer.from(_, "base64") silently drops
// out-of-alphabet characters, so any 32-byte value (an account pubkey from a
// renamed field, say) would decode into a plausible-looking field element and
// the violation would surface much later as a misleading integrity error.
export function decodeFieldElement(value: unknown, what: string): string {
    if (typeof value !== "string" || !/^\d+$/.test(value))
        throw new ApprovalWireSpecError(
            `${what} is not a decimal field element: ${JSON.stringify(value)}`,
        );
    const element = BigInt(value);
    if (element >= FIELD_MODULUS)
        throw new ApprovalWireSpecError(
            `${what} is not below the Pallas field modulus: ${value}`,
        );
    // Leaves are matched against hashPulsarActionLeafV2(...).toString() and
    // the roots against the contract's Field.toString() cursor, so a
    // zero-padded wire value must not become an unmatchable key or read as a
    // mismatch.
    return element.toString();
}

// Cosmos renders proto int64 as a quoted JSON string, so every height arrives
// as "56", not 56. A bare JSON number is not a shape this gateway produces;
// accepting one would only mask a spec change that should be seen.
function decodeInt64(value: unknown, what: string): bigint {
    if (typeof value !== "string" || !/^\d+$/.test(value))
        throw new ApprovalWireSpecError(
            `${what} is not a decimal int64: ${JSON.stringify(value)}`,
        );
    return BigInt(value);
}

// The protocol empty root, before any push has folded: the merklelist zero
// value — and also the approvalCursor a freshly deployed contract stores, so
// a walk from a virgin contract against a virgin chain meets here.
const EMPTY_ACTIONS_REDUCED_ROOT = "0";

// A chain that has never pushed reports height 0 for its (empty) batch —
// NewInitialBridgeState leaves the field at its zero value — so it doubles as
// "there is no push here", which is how the walk detects the far end of
// history.
const NO_PUSH_COSMOS_HEIGHT = 0n;

/**
 * One push batch: every action the chain scanned and adjudicated while
 * consuming the Mina interval (startMinaHeight, latestFetchedMinaHeight], as
 * folded into the actions_reduced_root at cosmosBlockHeight — under v2 one
 * verdict leaf per scanned action, approved or not.
 *
 * Several pushes inside one Cosmos block are merged by the chain into a single
 * cumulative batch (msg_server_push_new_actions.go concatenates the hashes and
 * keeps the earliest start), so one cosmos height always maps to exactly one
 * verifiable root transition.
 */
export interface ActionsBatch {
    startMinaHeight: bigint;
    latestFetchedMinaHeight: bigint;
    cosmosBlockHeight: bigint;
    actionHashes: string[];
}

export async function fetchActionsBatch(
    atCosmosHeight?: number,
): Promise<ActionsBatch> {
    let data;
    try {
        data = await fetchLatestActionHashes(getClient(), atCosmosHeight);
    } catch (error) {
        throw classifyGrpcFault(
            error,
            "Query/LatestActionHashes",
            atCosmosHeight,
        );
    }
    // The generated codec materialises the repeated field as [] even when the
    // wire carried nothing, so emptiness is legitimate (a push over empty
    // Mina blocks) and a re-tagged field is INVISIBLE here — the fold
    // verification downstream is what catches that class of drift. The array
    // guard is for the taxonomy, not the codec: a malformed value must strike
    // as a spec violation, never escape as a bare TypeError the worker would
    // wrap transient and retry forever.
    const hashes: unknown = data.action_hashes ?? [];
    if (!Array.isArray(hashes))
        throw new ApprovalWireSpecError(
            `LatestActionHashes action_hashes is not an array: ` +
                `got ${JSON.stringify(hashes)}`,
        );
    return {
        startMinaHeight: decodeInt64(
            data.start_mina_height,
            "start_mina_height",
        ),
        latestFetchedMinaHeight: decodeInt64(
            data.latest_fetched_mina_height,
            "latest_fetched_mina_height",
        ),
        cosmosBlockHeight: decodeInt64(
            data.action_hashes_cosmos_block_height,
            "action_hashes_cosmos_block_height",
        ),
        actionHashes: hashes.map((hash) =>
            decodeFieldElement(hash, "action_hashes entry"),
        ),
    };
}

export async function fetchActionsReducedRoot(
    atCosmosHeight?: number,
): Promise<string> {
    let data;
    try {
        data = await grpcFetchActionsReducedRoot(getClient(), atCosmosHeight);
    } catch (error) {
        throw classifyGrpcFault(
            error,
            "Query/ActionsReducedRoot",
            atCosmosHeight,
        );
    }
    return decodeFieldElement(
        data.actions_reduced_root,
        "actions_reduced_root",
    );
}

/**
 * A verified push carries its fold trace, not just its hashes: the walk must
 * locate the contract's approvalCursor, which can sit at any leaf boundary
 * INSIDE a push (a reduce may cut a batch anywhere), so every intermediate
 * cumulative root is kept alongside the batch.
 */
interface VerifiedBatch {
    batch: ActionsBatch;
    /** Cumulative root before this push (decimal). */
    rootBefore: string;
    /** folds[i] = cumulative root after folding actionHashes[0..i]. */
    folds: string[];
}

function rootAfter(verified: VerifiedBatch): string {
    return verified.folds[verified.folds.length - 1] ?? verified.rootBefore;
}

// Height-pinned batches are immutable chain state, so caching verified ones
// across calls spares refetching and refolding on worker retries — but ONLY a
// batch that passed fold verification may enter the cache (verify first, cache
// second, the same convention as validatorSet.ts's hash gate). Caching before
// verification would pin one corrupt response for the process lifetime and
// refold the same garbage into an ApprovalIntegrityError on every retry.
//
// Bounded because the process is long-lived and the cursor only moves forward:
// the window between the contract's cursor and the chain tip spans a handful
// of pushes, and once the cursor passes a push its batch can never be walked
// back to again. Without the cap every reduce would retain one more full fold
// trace for the lifetime of the process.
const MAX_VERIFIED_BATCHES = 64;
const verifiedBatchByCosmosHeight = new Map<number, VerifiedBatch>();

function cacheVerifiedBatch(verified: VerifiedBatch): void {
    verifiedBatchByCosmosHeight.set(
        Number(verified.batch.cosmosBlockHeight),
        verified,
    );
    // Map iterates in insertion order, so the first key is the oldest entry.
    while (verifiedBatchByCosmosHeight.size > MAX_VERIFIED_BATCHES)
        verifiedBatchByCosmosHeight.delete(
            verifiedBatchByCosmosHeight.keys().next().value as number,
        );
}

// Test hook: the cache is module state that outlives a single test, so
// scenarios reusing cosmos heights would otherwise verify against a batch
// their own oracle never served.
export function resetVerifiedBatchCache(): void {
    verifiedBatchByCosmosHeight.clear();
}

/**
 * Prove a batch really is what the chain folded at its own cosmos height —
 * folding its hashes onto the root of the preceding block must reproduce the
 * root the chain committed. That check is what makes the endpoint's answer
 * trustless: a node serving a doctored hash list cannot reproduce a root the
 * validators already signed. The fold is the v2 approval-cursor fold — the
 * SAME foldApprovalCursor the reduce circuit runs per batch slot.
 */
async function verifyBatch(batch: ActionsBatch): Promise<VerifiedBatch> {
    const height = Number(batch.cosmosBlockHeight);
    // The cached batch, not the one just fetched, is the verified one — a node
    // that answers differently for a height it already proved must not slip an
    // unverified list through on the strength of the earlier answer.
    const cached = verifiedBatchByCosmosHeight.get(height);
    if (cached) return cached;

    // Cosmos reads x-cosmos-block-height: 0 as LATEST, not genesis, so asking
    // for h−1 at cosmos height 1 would compare the CURRENT root against height
    // 1's. Height 1's pre-state IS genesis, and genesis is the one pre-state no
    // query can return. The empty root is therefore an ASSUMPTION here — true
    // of a fresh genesis, false of a zero-height restart; the mismatch branch
    // below is what tells them apart.
    const [rootBefore, rootAtHeight] = await Promise.all([
        height === 1
            ? Promise.resolve(EMPTY_ACTIONS_REDUCED_ROOT)
            : fetchActionsReducedRoot(height - 1),
        fetchActionsReducedRoot(height),
    ]);
    const folds: string[] = [];
    let running = Field(rootBefore);
    for (const leaf of batch.actionHashes) {
        running = foldApprovalCursor(running, Field(leaf));
        folds.push(running.toString());
    }
    const folded = folds[folds.length - 1] ?? rootBefore;
    if (folded !== rootAtHeight) {
        // At height 1 the assumed pre-state is the likelier suspect than the
        // data: a chain restarted through the standard Cosmos zero-height
        // export keeps its cumulative root at snapshot height 0 and restarts
        // block heights at 1, so genesis is non-empty. That is unreachable
        // history, not corrupt data.
        if (height === 1)
            throw new ApprovalHistoryPrunedError(
                `Cosmos height 1 does not fold the empty root into on-chain ` +
                    `root ${rootAtHeight} (folded ${folded}). Height 1's ` +
                    `pre-state is genesis, which no query returns, so the ` +
                    `empty root is assumed — and it does not hold here: this ` +
                    `chain was restarted from a genesis carrying a non-empty ` +
                    `cumulative actions root (Cosmos zero-height export), so ` +
                    `the covering push is on the far side of the restart. ` +
                    `Retrying cannot recover it: reconcile these approvals ` +
                    `against a node retaining the pre-restart history, or ` +
                    `manually.`,
            );
        throw new ApprovalIntegrityError(
            `Actions batch at cosmos height ${height} does not fold ` +
                `root ${rootBefore} into on-chain root ${rootAtHeight} ` +
                `(folded ${folded}) — this node served a hash list the chain ` +
                `did not commit at that height.`,
        );
    }
    const verified: VerifiedBatch = { batch, rootBefore, folds };
    cacheVerifiedBatch(verified);
    logger.debug("Actions push verified", {
        cosmosBlockHeight: height,
        minaRange: `(${batch.startMinaHeight}, ${batch.latestFetchedMinaHeight}]`,
        hashCount: batch.actionHashes.length,
        event: "actions_push_verified",
    });
    return verified;
}

/**
 * One push's contribution to the ordered leaf slice past the contract's
 * approvalCursor. The worker consumes the flattened leaves positionally
 * against the L1 action queue (BuildVerdictBatch), uses cosmosBlockHeight to
 * pick a covering signed root, and rootAfter to cross-check the archived
 * root it picked.
 */
export interface ApprovalPushSlice {
    /** Cosmos block whose state committed this push. */
    cosmosBlockHeight: number;
    /**
     * Ordered v2 verdict-leaf hashes (decimal) this push appended — the
     * OLDEST slice starts just past the cursor, every later one is whole.
     */
    leaves: string[];
    /** The chain's cumulative approval root after this push (decimal). */
    rootAfter: string;
}

/**
 * Collect the ordered v2 verdict-leaf slice extending the contract's
 * approvalCursor to the chain's current tip, grouped by push. Returns [] when
 * the cursor IS the tip (nothing adjudicated past it yet) — transient, retry
 * later.
 *
 * Each batch names the cosmos block that produced it, so reaching the pushes
 * before it is a walk (query the block before that one), not a search: every
 * step is exact, self-identifying and verifiable against the root transition
 * it claims — and because the contract's cursor is a prefix of the same fold,
 * the walk terminates exactly where a verified transition passes through it,
 * push boundary or mid-push. A fold mismatch throws ApprovalIntegrityError, a
 * batch out of reach (or a cursor on the far side of a restart) throws
 * ApprovalHistoryPrunedError and a response contradicting the wire spec
 * throws ApprovalWireSpecError — all three deterministic, none transient.
 * Network failures and a node that is down or shedding load propagate as
 * ordinary Errors.
 */
export async function collectApprovalLeaves(
    approvalCursor: string,
): Promise<ApprovalPushSlice[]> {
    let batch = await fetchActionsBatch();
    if (batch.cosmosBlockHeight === NO_PUSH_COSMOS_HEIGHT) {
        if (approvalCursor === EMPTY_ACTIONS_REDUCED_ROOT) return [];
        throw new ApprovalHistoryPrunedError(
            `The contract's approvalCursor is ${approvalCursor} but this ` +
                `chain has never pushed: the cursor cannot be a prefix of an ` +
                `empty leaf chain. Either the chain was reset under a live ` +
                `contract or this node serves a different chain — reconcile ` +
                `against the chain the contract actually settled, or rebase ` +
                `the chain's actions root to the contract's cursor ` +
                `(MsgRebaseActionsRoot).`,
        );
    }

    // Assembled newest-push-first via unshift, returned oldest-first — the
    // flattened leaves must extend the cursor in chain append order.
    const slices: ApprovalPushSlice[] = [];
    while (true) {
        const verified = await verifyBatch(batch);

        // The cursor is a prefix of the verified fold exactly when it equals
        // the root before this push or one of its intermediate folds; the
        // slice is everything after that point. folds[i] == cursor means
        // leaves 0..i are already consumed by the contract.
        const at =
            verified.rootBefore === approvalCursor
                ? -1
                : verified.folds.indexOf(approvalCursor);
        if (verified.rootBefore === approvalCursor || at !== -1) {
            const leaves = verified.batch.actionHashes.slice(at + 1);
            if (leaves.length > 0)
                slices.unshift({
                    cosmosBlockHeight: Number(batch.cosmosBlockHeight),
                    leaves,
                    rootAfter: rootAfter(verified),
                });
            return slices;
        }

        slices.unshift({
            cosmosBlockHeight: Number(batch.cosmosBlockHeight),
            leaves: verified.batch.actionHashes,
            rootAfter: rootAfter(verified),
        });

        const previousBlock = Number(batch.cosmosBlockHeight) - 1;
        if (previousBlock < 1)
            throw new ApprovalHistoryPrunedError(
                `The contract's approvalCursor ${approvalCursor} needs a ` +
                    `push before cosmos height ${batch.cosmosBlockHeight}, ` +
                    `which is the first block of this chain — its pre-state ` +
                    `is genesis, which no query returns. Reconcile against a ` +
                    `node retaining the pre-genesis history, or manually.`,
            );

        const previous = await fetchActionsBatch(previousBlock);
        if (previous.cosmosBlockHeight === NO_PUSH_COSMOS_HEIGHT)
            throw new ApprovalHistoryPrunedError(
                `The contract's approvalCursor ${approvalCursor} was not ` +
                    `passed by any verified push: the walk reached the ` +
                    `initial bridge state. The cursor is not a prefix of ` +
                    `this chain's leaf chain — a chain restarted from a ` +
                    `zero-height export (pre-restart history unreachable), ` +
                    `or a chain/L1 divergence needing a governance rebase ` +
                    `(MsgRebaseActionsRoot).`,
            );
        // The chain consumes Mina strictly forward from its cursor, so
        // consecutive batches must meet exactly. A gap means this node served
        // batches from different histories (or a fork), and folding them
        // together would produce a leaf slice no signed root backs.
        if (previous.latestFetchedMinaHeight !== batch.startMinaHeight)
            throw new ApprovalIntegrityError(
                `Actions batches do not meet: the batch at cosmos ` +
                    `height ${batch.cosmosBlockHeight} starts at Mina height ` +
                    `${batch.startMinaHeight}, but the batch visible one ` +
                    `block earlier ends at ` +
                    `${previous.latestFetchedMinaHeight}.`,
            );
        batch = previous;
    }
}
