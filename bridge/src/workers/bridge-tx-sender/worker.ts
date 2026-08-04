// o1js
import { Cache, Field, PublicKey, Signature } from "o1js";

// contracts
import { ActionStackProgram } from "pulsar-contracts/build/src/ActionStack.js";
import { ValidateReduceProgram } from "pulsar-contracts/build/src/ValidateReduce.js";
import { PulsarAction } from "pulsar-contracts/build/src/types/PulsarAction.js";
import {
    SignaturePublicKey,
    SignaturePublicKeyList,
} from "pulsar-contracts/build/src/types/signaturePubKeyList.js";
import { CalculateFinalActionState } from "pulsar-contracts/build/src/utils/actionQueueUtils.js";
import { GenerateValidateReduceProof } from "pulsar-contracts/build/src/utils/generateFunctions.js";
import { fetchActions } from "pulsar-contracts/build/src/utils/fetch.js";
import { PrepareBatchWithActions } from "pulsar-contracts/build/src/utils/reduceWitness.js";
import { VALIDATOR_NUMBER } from "pulsar-contracts/build/src/utils/constants.js";

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
    getContractSettledHeight,
    getActionStateHistory,
} from "../../services/mina/client.js";
import { requestSignatures } from "../../services/pulsar/client.js";
import {
    type OrderedValidator,
    resolveValidatorSetForRoot,
} from "../../services/pulsar/validatorSet.js";
import {
    proveReduceTx,
    sendProvedReduceTx,
} from "../../services/mina/txSender.js";
import type { BridgeTxJob } from "./master.js";

type PackedAction = { action: PulsarAction; hash: bigint };

/**
 * Environmental failures (archive lag/outage) that retrying will heal on its
 * own — the failure listener logs them WITHOUT charging the queue front's
 * failure budget, so a seconds-long archive blip can never trip the circuit
 * breaker against a healthy front.
 */
export class TransientReduceError extends Error {
    readonly transient = true;
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
        // Dependency order: the contract verifies proofs of all three programs.
        await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
        await ValidateReduceProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
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
 * fetchActions, and the batch/stack are rebuilt from scratch on every attempt.
 * That makes retries and crash recovery trivial — whatever landed on-chain
 * already moved state[0], so the next attempt simply starts from the new
 * front. The master re-queues a job as long as a gap to the queue tip remains.
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
            throw new Error(
                `Refolded action queue ends at ${computedTip}, which matches ` +
                    `none of the account's stored action states — refusing ` +
                    `to prove against an unverifiable reconstruction`,
            );
        }
    }

    // Mark the attempt in-flight BEFORE the expensive proving: if it OOMs or
    // crashes, startup finds txAttemptActive and books the failure.
    await BridgeStateModel.updateOne({}, { $set: { txAttemptActive: true } });

    // Placeholder approval set: every pending action is approved. Deposits
    // are intrinsically safe (funds already escrowed on L1); withdrawals are
    // paid for whatever this map contains, so the REAL map must come from the
    // validators once the /getSignature spec covers it.
    const includedActions = new Map<string, number>();
    for (const pack of packed) {
        const hash = pack.action.unconstrainedHash().toString();
        includedActions.set(hash, (includedActions.get(hash) ?? 0) + 1);
    }

    const { batchActions, batch, useActionStack, actionStackProof, publicInput, mask } =
        await PrepareBatchWithActions(includedActions, ctx.contract, packed);

    logger.info("Batch prepared from the on-chain queue", {
        fromActionState: processed,
        pendingCount: packed.length,
        batchCount: batchActions.length,
        useActionStack: useActionStack.toBoolean(),
        event: "reduce_batch_prepared",
    });

    const signatures = await requestSignatures(processed, computedTip);

    logger.info("Validator signatures received", {
        fromActionState: processed,
        sigCount: signatures.length,
        event: "signatures_received",
    });

    // The circuit rebuilds the validator MerkleList from ALL slots and asserts
    // it equals merkleListRoot, so the signature list must carry the full
    // ordered set (with powers) — not just the validators that signed.
    // Height comes from the SAME cached snapshot as merkleListRoot: a fresh
    // fetch could observe a newer settlement than the cached root.
    const validatorSet = await resolveValidatorSetForRoot(
        getContractMerkleRoot(ctx),
        getContractSettledHeight(ctx),
    );

    // Fail fast with a clear error when quorum is impossible even if every
    // received signature verifies — proving would only fail in-circuit after
    // minutes of wasted work ("Not enough signed voting power").
    assertPossibleQuorum(validatorSet, signatures, {
        fromActionState: processed,
    });

    const validateReduceProof = await GenerateValidateReduceProof(
        publicInput,
        buildSignatureList(validatorSet, signatures),
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
        mask,
        validateReduceProof,
        fromActionState: processed,
    });

    await sendProvedReduceTx(ctx, provedTxJson, processed);

    await BridgeStateModel.updateOne(
        {},
        { $set: { txAttemptActive: false } },
    );

    logger.info("Reduce TX done", {
        fromActionState: processed,
        batchCount: batchActions.length,
        remainingCount: packed.length - batchActions.length,
        event: "reduce_tx_done",
    });
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
        { upsert: true },
    );
}

/**
 * Optimistic 2/3 voting-power pre-check: counts every RECEIVED signature as
 * valid (the circuit is the real enforcer). If even that upper bound misses
 * quorum, GenerateValidateReduceProof is guaranteed to fail in-circuit —
 * throw the clear error up front instead.
 */
export function assertPossibleQuorum(
    validators: OrderedValidator[],
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
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
                `2/3 quorum even if every received signature is valid`,
        );
    }
}

export function buildSignatureList(
    validators: OrderedValidator[],
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
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
