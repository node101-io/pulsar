// o1js
import { Cache, Field, PublicKey, Signature } from "o1js";

// contracts
import { ActionStackProgram } from "pulsar-contracts/build/src/ActionStack.js";
import { SettleAttestProgram } from "pulsar-contracts/build/src/SettleAttest.js";
import { ApprovalQuorumProgram } from "pulsar-contracts/build/src/ApprovalQuorum.js";
import { ApprovalTailProgram } from "pulsar-contracts/build/src/ApprovalTail.js";
import {
    SignaturePublicKey,
    SignaturePublicKeyList,
} from "pulsar-contracts/build/src/types/signaturePubKeyList.js";
import { VoteExtBody } from "pulsar-contracts/build/src/types/voteExtBody.js";
import { CalculateFinalActionState } from "pulsar-contracts/build/src/utils/actionQueueUtils.js";
import {
    GenerateActionStackProof,
    GenerateApprovalQuorumProof,
    GenerateApprovalTailProof,
} from "pulsar-contracts/build/src/utils/generateFunctions.js";
import { fetchActions } from "pulsar-contracts/build/src/utils/fetch.js";
import { BuildVerdictBatch } from "pulsar-contracts/build/src/utils/reduceWitness.js";
import { VALIDATOR_NUMBER } from "pulsar-contracts/build/src/utils/constants.js";
import type { PulsarAction } from "pulsar-contracts/build/src/types/PulsarAction.js";

// bridge
import { CACHE_DIR } from "../../config/constants.js";
import logger from "../../common/logger.js";
import { BridgeStateModel } from "../../db/models/BridgeState.js";
import {
    type MinaClientContext,
    initMinaClientContext,
    refreshContractState,
    getContractMerkleRoot,
    getContractActionState,
    getContractApprovalCursor,
    getContractSettledHeight,
    getActionStateHistory,
} from "../../services/mina/client.js";
import {
    type OrderedValidator,
    resolveValidatorSetForRoot,
} from "../../services/pulsar/validatorSet.js";
import {
    ApprovalHistoryPrunedError,
    ApprovalIntegrityError,
    ApprovalWireSpecError,
    type ApprovalPushSlice,
    collectApprovalLeaves,
} from "../../services/pulsar/actionHashes.js";
import { findSignedRootAtOrBeyond } from "../../services/pulsar/voteExtensions.js";
import {
    proveReduceTx,
    sendProvedReduceTx,
} from "../../services/mina/txSender.js";
import type { BridgeTxJob } from "./master.js";

type PackedAction = { action: PulsarAction; hash: bigint };

/**
 * A validator's vote-extension signature rebuilt from a signed-root read —
 * the shape assertPossibleQuorum / buildSignatureList join against the
 * ordered validator set.
 */
export interface ValidatorSignature {
    validatorPublicKey: PublicKey;
    signature: Signature;
}

/**
 * Environmental failures (archive lag/outage, the chain trailing the queue,
 * a missed signature window) that retrying will heal on its own —
 * the failure listener logs them WITHOUT charging the queue front's failure
 * budget, so a seconds-long blip can never trip the circuit breaker against a
 * healthy front.
 */
export class TransientReduceError extends Error {
    readonly transient = true;

    // Always wrap with { cause }: the message keeps the operator's context
    // while the logger's errWithCause serializer still prints the frame that
    // actually failed (fetch rejects with a bare "fetch failed" whose real
    // reason — ENOTFOUND, the URL — lives only on the cause).
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "TransientReduceError";
    }
}

let compiled = false;
let compileLock: Promise<void> = Promise.resolve();
export async function ensureCompiled(): Promise<void> {
    compileLock = compileLock.then(async () => {
        if (compiled) return;

        // Deferred imports: declaring SettlementContract executes its @method
        // decorators against the proof classes, which unit tests replace with
        // mocks — only the compile path may load these modules.
        const [{ MultisigVerifierProgram }, { SettlementContract }] =
            await Promise.all([
                import("pulsar-contracts/build/src/SettlementProof.js"),
                import("pulsar-contracts/build/src/SettlementContract.js"),
            ]);

        logger.info("Compiling ZK programs for bridge-tx-sender…", {
            event: "bridge_compile_start",
        });
        // Dependency order: the quorum program verifies tail proofs, and the
        // contract verifies proofs of the settlement, quorum and stack
        // programs.
        await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await SettleAttestProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await ApprovalTailProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await ApprovalQuorumProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await ActionStackProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await SettlementContract.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        compiled = true;
        logger.info("ZK programs compiled for bridge-tx-sender.", {
            event: "bridge_compile_done",
        });
    });
    await compileLock;
}

let _ctx: MinaClientContext | null = null;
async function getCtx(): Promise<MinaClientContext> {
    if (!_ctx) _ctx = await initMinaClientContext();
    return _ctx;
}

/**
 * One job = one reduce over the FRONT of the contract's pending action queue.
 *
 * The chain is the single source of truth: the queue front is the contract's
 * own actionState (state[0]), the pending actions come from the archive via
 * fetchActions, the verdicts come from the Pulsar chain's v2 leaf chain past
 * the contract's approvalCursor (state[4]), and the quorum proof targets a
 * vote-extension body the validators really signed, read on demand from the
 * chain's vote-extension state. Everything is rebuilt from scratch on every attempt, which makes
 * retries and crash recovery trivial — whatever landed on-chain already moved
 * state[0]/state[4], so the next attempt simply starts from the new front.
 * The master re-queues a job as long as a gap to the queue tip remains.
 */
export async function worker(task: BridgeTxJob): Promise<void> {
    const ctx = await getCtx();
    await refreshContractState(ctx);

    const processed = getContractActionState(ctx);
    if (getActionStateHistory(ctx)[0] === processed) {
        logger.info("Queue front already reduced — nothing pending", {
            requestedFrom: task.fromActionState,
            event: "reduce_nothing_pending",
        });
        return;
    }

    // Stamp the failure identity FIRST: every strike the failure listener
    // books must be attributed to the front this attempt actually targets,
    // including strikes from throws below (e.g. the reconstruction check).
    await recordAttempt(processed);

    let packed: PackedAction[];
    try {
        packed = await fetchActions(ctx.contractAddress, Field(processed));
    } catch (error) {
        throw new TransientReduceError(
            `Archive fetch failed for queue front ${processed}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
    if (packed.length === 0) {
        // The account shows a gap the archive has not indexed yet.
        throw new TransientReduceError(
            `Contract shows pending actions (state ${processed} != tip ` +
                `${getActionStateHistory(ctx)[0]}) but the archive returned ` +
                `none — archive lag`,
        );
    }

    // Fail-fast reconstruction check BEFORE any proving: refold the fetched
    // queue and require the result to be one of the account's five stored
    // action states. A mismatch means the archive data cannot be what the
    // ledger applied (wrong order, missing action, failed-command action) and
    // would only surface later as an opaque on-chain rejection.
    const computedTip = CalculateFinalActionState(
        Field(processed),
        packed.map((pack) => pack.action),
    ).toString();
    if (!getActionStateHistory(ctx).includes(computedTip)) {
        // One refresh: actions dispatched between our account snapshot and
        // the archive read legitimately move the tip forward.
        await refreshContractState(ctx);
        if (!getActionStateHistory(ctx).includes(computedTip)) {
            // Transient like its two siblings above: under sustained action
            // traffic the archive trailing the node by more than the
            // account's five stored states produces exactly this mismatch,
            // and it heals the moment the archive catches up (live
            // 2026-08-16: three such strikes halted a healthy front mid-M1).
            // No strike is right here regardless of cause — the refusal
            // happens before any proving or fee, and strikes exist to stop
            // fee burn, not free retries. A genuinely corrupt archive stays
            // visible as this error repeating at level 50.
            throw new TransientReduceError(
                `Refolded action queue ends at ${computedTip}, which matches ` +
                    `none of the account's stored action states — refusing ` +
                    `to prove against an unverifiable reconstruction`,
            );
        }
    }

    // The chain's verdicts, walked from the contract's own approvalCursor —
    // all fetched BEFORE the in-flight flag: the transient waits below (the
    // chain trailing the queue, a missed signature window) must
    // not read as an interrupted expensive attempt that startup would book as
    // a strike.
    const approvalCursor = getContractApprovalCursor(ctx);
    let pushes: ApprovalPushSlice[];
    try {
        pushes = await collectApprovalLeaves(approvalCursor);
    } catch (error) {
        // Deterministic faults — a fold mismatch, a response contradicting
        // the wire spec (HTML 200, renamed field, a node too old to serve the
        // query), or a cursor out of reach (pruned, restarted, diverged) —
        // must strike the failure budget: wrapping them transient would retry
        // the same bytes forever without ever tripping the breaker. Only
        // genuine network failures stay transient.
        if (
            error instanceof ApprovalIntegrityError ||
            error instanceof ApprovalWireSpecError ||
            error instanceof ApprovalHistoryPrunedError
        )
            throw error;
        throw new TransientReduceError(
            `Pulsar chain approval walk failed: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }

    const chainLeaves = pushes.flatMap((push) => push.leaves);
    if (chainLeaves.length === 0) {
        throw new TransientReduceError(
            `Pulsar chain has not adjudicated past the contract's approval ` +
                `cursor ${approvalCursor} — waiting for the next push`,
        );
    }

    // Positional match of the L1 queue against the chain's verdict leaves.
    // BuildVerdictBatch THROWS when a chain leaf matches neither verdict of
    // the action at its position (chain/L1 divergence) — deterministic, so it
    // propagates and strikes; a governance rebase is the remedy, not a retry.
    const { batch, verdicts, batchActions, endCursor } = BuildVerdictBatch(
        packed,
        chainLeaves.map((leaf) => Field(leaf)),
        Field(approvalCursor),
    );
    const consumed = batchActions.length;

    // The push that appended the last consumed leaf bounds the usable signed
    // roots from below: any root signed at or beyond its state height commits
    // to every leaf the batch folds.
    let coveringHeight = 0;
    let seen = 0;
    for (const push of pushes) {
        seen += push.leaves.length;
        if (seen >= consumed) {
            coveringHeight = push.cosmosBlockHeight;
            break;
        }
    }

    // OLDEST readable at-or-beyond, not the tip: every block re-signs the
    // current root, so the covering height itself is tried first — the older
    // the root, the shorter the tail the quorum proof folds. A missed
    // persistence window or pruned version only lengthens the tail via the
    // latest-root fallback, never blocks.
    const merkleListRoot = getContractMerkleRoot(ctx);
    const signedRoot = await findSignedRootAtOrBeyond(
        coveringHeight,
        merkleListRoot,
    );
    if (!signedRoot) {
        throw new TransientReduceError(
            `No readable signed root at or beyond cosmos height ` +
                `${coveringHeight} carries the contract's validator-set root ` +
                `— waiting for the next block (or the next settlement) to ` +
                `re-sign it`,
        );
    }

    const { tailLeaves, terminalRoot } = trimTailAtSignedRoot(
        pushes,
        chainLeaves,
        consumed,
        {
            cosmosHeight: signedRoot.cosmosHeight,
            actionsReducedRoot: signedRoot.body.actionsReducedRoot,
        },
    );

    // The circuit rebuilds the validator MerkleList from ALL slots and asserts
    // it equals merkleListRoot, so the signature list must carry the full
    // ordered set (with powers) — not just the validators that signed.
    // Height comes from the SAME cached snapshot as merkleListRoot: a fresh
    // fetch could observe a newer settlement than the cached root.
    const validatorSet = await resolveValidatorSetForRoot(
        merkleListRoot,
        getContractSettledHeight(ctx),
    );

    const signatures: ValidatorSignature[] = signedRoot.signatures.map(
        (sig) => ({
            validatorPublicKey: PublicKey.fromBase58(sig.minaPublicKey),
            signature: Signature.fromValue({
                r: BigInt(sig.r),
                s: BigInt(sig.s),
            }),
        }),
    );

    // Fail fast with a clear error when quorum is impossible even if every
    // archived signature verifies — proving would only fail in-circuit after
    // minutes of wasted work ("Not enough signed voting power").
    assertPossibleQuorum(validatorSet, signatures, {
        fromActionState: processed,
        signedRootHeight: signedRoot.cosmosHeight,
    });

    logger.info("Batch prepared from the on-chain queue", {
        fromActionState: processed,
        pendingCount: packed.length,
        batchCount: consumed,
        tailLength: tailLeaves.length,
        signedRootHeight: signedRoot.cosmosHeight,
        actionsReducedRoot: terminalRoot,
        event: "reduce_batch_prepared",
    });

    // Mark the attempt in-flight BEFORE the expensive proving: if it OOMs or
    // crashes, startup finds txAttemptActive and books the failure.
    await BridgeStateModel.updateOne({}, { $set: { txAttemptActive: true } });

    // The stack absorbs the unbatched remainder of the queue: anchored at the
    // batch-end action state (what the contract asserts the proof's
    // publicInput equals) and folding to the account tip.
    const endActionState = CalculateFinalActionState(
        Field(processed),
        batchActions,
    );
    const { useActionStack, actionStackProof } = await GenerateActionStackProof(
        endActionState,
        packed.slice(consumed).map((pack) => pack.action),
    );

    // The tail extends the batch-end cursor to the signed root; an empty tail
    // is a REAL base proof (identity), never a dummy.
    const tailProof = await GenerateApprovalTailProof(
        endCursor,
        tailLeaves.map((leaf) => Field(leaf)),
    );

    // The program folds the batch's two cursors itself (the in-contract
    // verdict fold died with the o1js wrap bug — see ApprovalQuorum.ts), so
    // it takes the batch and its start points; endActionState/cursorAfter
    // are recomputed inside from the same shared helpers.
    const approvalProof = await GenerateApprovalQuorumProof(
        batch,
        verdicts,
        Field(processed),
        Field(approvalCursor),
        new VoteExtBody({
            nextValidatorSetHash: Field(signedRoot.body.nextValidatorSetHash),
            stateRootHi: Field(signedRoot.body.stateRootHi),
            stateRootLo: Field(signedRoot.body.stateRootLo),
            currentBlockHeight: Field(signedRoot.cosmosHeight),
            actionsReducedRoot: Field(signedRoot.body.actionsReducedRoot),
        }),
        buildSignatureList(validatorSet, signatures),
        tailProof,
    );

    logger.info("Proofs generated", {
        fromActionState: processed,
        useActionStack: useActionStack.toBoolean(),
        event: "proofs_generated",
    });

    const provedTxJson = await proveReduceTx({
        ctx,
        batch,
        useActionStack,
        actionStackProof,
        verdicts,
        cursorAfter: Field(endCursor),
        approvalProof,
        fromActionState: processed,
    });

    await sendProvedReduceTx(ctx, provedTxJson, processed);

    await BridgeStateModel.updateOne(
        {},
        { $set: { txAttemptActive: false } },
    );

    logger.info("Reduce TX done", {
        fromActionState: processed,
        batchCount: consumed,
        remainingCount: packed.length - consumed,
        event: "reduce_tx_done",
    });
}

/**
 * The tail = every unconsumed leaf the signed root's actionsReducedRoot
 * commits to: the remainder of the pushes at or before its signed state
 * height. Cross-checked before any proving — the leaf walk and the pinned
 * vote extension are two reads onto the same fold, and if they disagree
 * the quorum proof is unsatisfiable, so the mismatch must surface here with
 * the right taxonomy instead of minutes later in-circuit.
 */
function trimTailAtSignedRoot(
    pushes: ApprovalPushSlice[],
    chainLeaves: string[],
    consumed: number,
    signedRoot: { cosmosHeight: number; actionsReducedRoot: string },
): { tailLeaves: string[]; terminalRoot: string } {
    let included = 0;
    let terminalRoot = "";
    for (const push of pushes) {
        if (push.cosmosBlockHeight > signedRoot.cosmosHeight) break;
        included += push.leaves.length;
        terminalRoot = push.rootAfter;
    }

    if (terminalRoot !== signedRoot.actionsReducedRoot) {
        const walkTip = pushes[pushes.length - 1].cosmosBlockHeight;
        if (signedRoot.cosmosHeight > walkTip) {
            // The signed root out-raced the walk (a push landed between the
            // leaf walk and the vote-extension read): it commits to leaves
            // the walk has not seen yet. The next attempt re-walks and sees
            // them.
            throw new TransientReduceError(
                `Signed root at cosmos height ` +
                    `${signedRoot.cosmosHeight} is newer than the walked ` +
                    `leaf list (tip push at ${walkTip}) and commits to ` +
                    `${signedRoot.actionsReducedRoot}, not ${terminalRoot} ` +
                    `— re-walking on the next attempt`,
            );
        }
        throw new ApprovalIntegrityError(
            `Signed root at cosmos height ` +
                `${signedRoot.cosmosHeight} commits to actions root ` +
                `${signedRoot.actionsReducedRoot}, but the verified leaf ` +
                `walk folds to ${terminalRoot} at that height — the chain's ` +
                `leaf list and its vote extensions disagree about the ` +
                `same chain state.`,
        );
    }

    return { tailLeaves: chainLeaves.slice(consumed, included), terminalRoot };
}

/**
 * Failure identity = the queue front being attempted. A front that moved
 * means progress happened, so the counter restarts; the same front failing
 * MAX_FAIL_COUNT times (transient failures excepted) halts the master.
 * txAttemptActive stays untouched here — it flips on only when the expensive
 * in-flight phase (proving/sending) begins.
 */
async function recordAttempt(fromActionState: string): Promise<void> {
    await BridgeStateModel.updateOne(
        {},
        [
            {
                $set: {
                    txFailCount: {
                        $cond: [
                            {
                                $eq: [
                                    "$txAttemptActionState",
                                    { $literal: fromActionState },
                                ],
                            },
                            { $ifNull: ["$txFailCount", 0] },
                            0,
                        ],
                    },
                    txAttemptActionState: { $literal: fromActionState },
                },
            },
        ],
        { upsert: true, updatePipeline: true },
    );
}

/**
 * Optimistic 2/3 voting-power pre-check: counts every ARCHIVED signature as
 * valid (the circuit is the real enforcer). If even that upper bound misses
 * quorum, GenerateApprovalQuorumProof is guaranteed to fail in-circuit —
 * throw the clear error up front instead.
 */
export function assertPossibleQuorum(
    validators: OrderedValidator[],
    signatures: ValidatorSignature[],
    logMeta: object = {},
): void {
    const signerKeys = new Set(
        signatures.map((s) => s.validatorPublicKey.toBase58()),
    );

    let signedPower = 0n;
    let totalPower = 0n;
    for (const v of validators) {
        const power = BigInt(v.power);
        totalPower += power;
        if (signerKeys.has(v.minaPublicKey)) signedPower += power;
    }

    if (signedPower * 3n < totalPower * 2n) {
        logger.error("Signed voting power below 2/3 quorum", {
            ...logMeta,
            signedPower: signedPower.toString(),
            totalPower: totalPower.toString(),
            sigCount: signatures.length,
            event: "quorum_not_reached",
        });
        throw new Error(
            `Signed voting power ${signedPower}/${totalPower} is below the ` +
                `2/3 quorum even if every archived signature is valid`,
        );
    }
}

export function buildSignatureList(
    validators: OrderedValidator[],
    signatures: ValidatorSignature[],
): SignaturePublicKeyList {
    if (validators.length !== VALIDATOR_NUMBER) {
        throw new Error(
            `validator set size ${validators.length} != VALIDATOR_NUMBER ` +
                `${VALIDATOR_NUMBER} — the circuit sizes its leaf list to it`,
        );
    }

    const sigByKey = new Map(
        signatures.map((s) => [s.validatorPublicKey.toBase58(), s.signature]),
    );

    // Every validator keeps its (publicKey, power) leaf in the chain's fold
    // order. A non-signer gets the well-formed dummy signature (r=1, s=1):
    // it fails signature.verify in the circuit (excluded from accumulated
    // power) while its leaf + power still reproduce the root and the totals.
    return new SignaturePublicKeyList({
        list: validators.map(
            (v) =>
                new SignaturePublicKey({
                    publicKey: PublicKey.fromBase58(v.minaPublicKey),
                    signature:
                        sigByKey.get(v.minaPublicKey) ??
                        Signature.fromValue({ r: 1n, s: 1n }),
                    power: Field(v.power),
                }),
        ),
    });
}
