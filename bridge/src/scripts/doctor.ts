import { fetchAccount, Field, PrivateKey, PublicKey, Signature } from "o1js";
import { fetchActions } from "pulsar-contracts/build/src/utils/fetch.js";
import {
    TendermintClient,
    fetchBridgeParams,
    getLatestHeight,
    grpcCredentials,
} from "pulsar-chain-client";

import { initDb } from "../db/connection.js";
import { getBridgeState } from "../db/models/BridgeState.js";
import { env } from "../config/env.js";
import { MAX_FAIL_COUNT } from "../config/constants.js";
import {
    getActionStateHistory,
    getContractActionState,
    getContractApprovalCursor,
    getContractMerkleRoot,
    getContractSettledHeight,
    initMinaClientContext,
} from "../services/mina/client.js";
import {
    ApprovalHistoryPrunedError,
    ApprovalIntegrityError,
    ApprovalWireSpecError,
    collectApprovalLeaves,
    fetchActionsBatch,
    getBridgeQueryClient,
} from "../services/pulsar/actionHashes.js";
import { resolveValidatorSetForRoot } from "../services/pulsar/validatorSet.js";
import { findSignedRootAtOrBeyond } from "../services/pulsar/voteExtensions.js";
import { assertPossibleQuorum } from "../workers/bridge-tx-sender/worker.js";
import { bridgeTxSenderQ } from "../workers/queue.js";

// One-shot diagnosis of where the bridge is stuck. The reduce pipeline is a
// chain of links — contract, chain, approval walk, proof inputs, breaker — and
// a stall in ANY of them presents identically from the outside: nothing
// happens. So the sections run in the pipeline's own dependency order and the
// verdict names the FIRST broken link, because fixing a later one while an
// earlier one is broken changes nothing.
//
// Read-only. It never writes Mongo, never enqueues, never sends a tx — safe to
// run against a live bridge, and safe to run while the bridge is down.
//
// The service modules this calls log their own startup breadcrumbs at info
// ("Mina client initialized", "Connected to MongoDB"), so a few lines land
// between the sections — the same as the prover's doctor. `LOG_LEVEL=warn`
// removes them; do not go to `error`, because validatorSet's per-height
// "Validator set fetch failed" warn carries the gRPC reason and the thrown
// error only lists WHICH heights failed, not why.

const OK = "✓";
const WARN = "⚠";
const BAD = "✗";

function section(title: string) {
    console.log(`\n── ${title} ${"─".repeat(Math.max(1, 60 - title.length))}`);
}

function short(value: string, keep = 12): string {
    return value.length <= keep * 2 ? value : `${value.slice(0, keep)}…${value.slice(-6)}`;
}

function errName(error: unknown): string {
    if (error instanceof ApprovalWireSpecError) return "ApprovalWireSpecError";
    if (error instanceof ApprovalIntegrityError) return "ApprovalIntegrityError";
    if (error instanceof ApprovalHistoryPrunedError)
        return "ApprovalHistoryPrunedError";
    return error instanceof Error ? error.constructor.name : "unknown";
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

let verdict: string | null = null;
function setVerdict(v: string) {
    if (!verdict) verdict = v;
}

async function main() {
    console.log(
        `\nBridge doctor — network ${env.MINA_NETWORK}, chain ${env.PULSAR_GRPC_ENDPOINT}`,
    );

    // ── 1. contract link ────────────────────────────────────────────────
    // Everything downstream reads from this account: the work signal, the
    // validator-set root the quorum proof is pinned to, and the approval
    // cursor the chain walk anchors on.
    section("Contract");
    let ctx: Awaited<ReturnType<typeof initMinaClientContext>> | null = null;
    let pendingOnChain = false;
    try {
        ctx = await initMinaClientContext();
        const processed = getContractActionState(ctx);
        const tip = getActionStateHistory(ctx)[0] ?? "?";
        pendingOnChain = processed !== tip;
        console.log(`${OK} address        ${env.CONTRACT_ADDRESS}`);
        console.log(`  actionState    ${short(processed)}`);
        console.log(`  queue tip      ${short(tip)}`);
        console.log(`  merkleListRoot ${short(getContractMerkleRoot(ctx))}`);
        console.log(`  approvalCursor ${short(getContractApprovalCursor(ctx))}`);
        console.log(`  settledHeight  ${getContractSettledHeight(ctx)}`);
        console.log(
            pendingOnChain
                ? `${OK} work signal    PENDING — the queue has moved past what the contract consumed`
                : `${OK} work signal    idle — contract has consumed the whole queue`,
        );
    } catch (error) {
        console.log(`${BAD} cannot read the contract: ${message(error)}`);
        setVerdict(
            "Contract unreachable or not a deployed zkApp — check " +
                "CONTRACT_ADDRESS and MINA_NETWORK before anything else.",
        );
    }

    // ── 2. chain link ───────────────────────────────────────────────────
    // The chain must be adjudicating OUR contract, and its scan cursor must
    // be moving — a frozen cursor means the pusher is dead or the wrapper is
    // stuck, and no amount of bridge restarting will produce a leaf.
    section("Chain");
    let chainTip: number | null = null;
    try {
        const tm = new TendermintClient(
            env.PULSAR_GRPC_ENDPOINT,
            grpcCredentials(env.PULSAR_GRPC_ENDPOINT),
        );
        chainTip = await getLatestHeight(tm);
        console.log(`${OK} tip            ${chainTip}`);
    } catch (error) {
        console.log(`${BAD} unreachable    ${message(error)}`);
        setVerdict(
            `Pulsar gRPC ${env.PULSAR_GRPC_ENDPOINT} is unreachable — the ` +
                "bridge cannot read verdicts, the validator set or signed roots.",
        );
    }

    try {
        const params = (await fetchBridgeParams(getBridgeQueryClient())).params;
        const configured = params?.contract_address ?? "(none)";
        const matches = configured === env.CONTRACT_ADDRESS;
        console.log(
            `${matches ? OK : BAD} x/bridge params contract_address ${short(configured, 10)}`,
        );
        if (!matches) {
            setVerdict(
                `The chain adjudicates ${configured} but this bridge watches ` +
                    `${env.CONTRACT_ADDRESS}. They must be the same contract — ` +
                    "the address is baked into genesis, so this is not " +
                    "fixable from our side.",
            );
        }
        console.log(
            `  start_block_height ${params?.start_block_height ?? "?"}   ` +
                `max_block_range ${params?.max_block_range ?? "?"}`,
        );
    } catch (error) {
        console.log(`${BAD} params query failed: ${message(error)}`);
        setVerdict(
            "x/bridge Query/Params failed — is this node running the " +
                "bridge module at the expected version?",
        );
    }

    try {
        const batch = await fetchActionsBatch();
        console.log(
            `${OK} scan cursor    mina ${batch.latestFetchedMinaHeight} ` +
                `(batch of ${batch.actionHashes.length} leaves at cosmos ` +
                `${batch.cosmosBlockHeight})`,
        );
        if (chainTip !== null) {
            const behind = chainTip - Number(batch.cosmosBlockHeight);
            // The pusher ticks once a minute and the chain makes a block
            // every few seconds, so a batch thousands of blocks old means
            // nothing has been adjudicated in a long time.
            const stale = behind > 2000;
            console.log(
                `${stale ? WARN : OK} last push     ${behind} cosmos blocks ago`,
            );
            if (stale)
                setVerdict(
                    `The chain's last adjudication was ${behind} blocks ago — ` +
                        "the pusher is not landing transactions. Check the " +
                        "bridge log for push_* events (pusher_disabled, " +
                        "push_tick_failed, push_unreachable_start, " +
                        "push_chain_invariant).",
                );
        }
    } catch (error) {
        console.log(`${BAD} ${errName(error)}: ${message(error)}`);
        setVerdict(
            `LatestActionHashes failed (${errName(error)}) — a node older ` +
                "than the action-hashes rename answers UNIMPLEMENTED here.",
        );
    }

    // ── 3. approval walk ────────────────────────────────────────────────
    // The exact call the worker makes, with the exact cursor. Its thrown
    // class IS the diagnosis, so it is printed verbatim rather than
    // summarised — each class has a different remedy and none of them is
    // "restart and hope".
    section("Approval walk");
    if (ctx) {
        const cursor = getContractApprovalCursor(ctx);
        try {
            const pushes = await collectApprovalLeaves(cursor);
            const leaves = pushes.reduce((n, p) => n + p.leaves.length, 0);
            if (leaves === 0) {
                console.log(
                    `${OK} clean, but the chain has not adjudicated past the ` +
                        "cursor yet — nothing to reduce",
                );
                if (pendingOnChain)
                    setVerdict(
                        "The contract has pending actions but the chain has " +
                            "not judged them yet. Normal while waiting for a " +
                            "push; a stall if the scan cursor above is old.",
                    );
            } else {
                console.log(
                    `${OK} ${leaves} leaf/leaves past the cursor across ` +
                        `${pushes.length} push(es), verified against the ` +
                        "on-chain root",
                );
            }
        } catch (error) {
            console.log(`${BAD} ${errName(error)}`);
            console.log(`  ${message(error)}`);
            setVerdict(
                `The approval walk fails with ${errName(error)}. This is ` +
                    "deterministic — it strikes the failure budget and will " +
                    "never clear by retrying. The message above names the fix.",
            );
        }
    } else {
        console.log("  skipped — no contract state");
    }

    // ── 4. proof inputs ─────────────────────────────────────────────────
    // Everything the quorum proof needs, resolved in the same order and by
    // the same functions the worker uses — so a failure here is exactly the
    // failure the worker would hit, minus the minutes of proving.
    section("Proof inputs");
    if (ctx) {
        const merkleRoot = getContractMerkleRoot(ctx);
        try {
            const validators = await resolveValidatorSetForRoot(
                merkleRoot,
                getContractSettledHeight(ctx),
            );
            console.log(
                `${OK} validator set  ${validators.length} validators reproduce ` +
                    "the contract's merkleListRoot",
            );

            const signed = await findSignedRootAtOrBeyond(
                getContractSettledHeight(ctx),
                merkleRoot,
            );
            if (!signed) {
                console.log(
                    `${WARN} signed root    none readable carries this ` +
                        "validator-set root",
                );
                setVerdict(
                    "No usable signed root: every candidate either missed its " +
                        "one-block signature window or was signed under a " +
                        "different validator set. Transient if the chain is " +
                        "live — the next block re-signs.",
                );
            } else {
                console.log(
                    `${OK} signed root    cosmos ${signed.cosmosHeight}, ` +
                        `${signed.signatures.length} signature(s), actions root ` +
                        short(signed.body.actionsReducedRoot),
                );
                try {
                    assertPossibleQuorum(
                        validators,
                        signed.signatures.map((sig) => ({
                            validatorPublicKey: PublicKey.fromBase58(
                                sig.minaPublicKey,
                            ),
                            signature: Signature.fromValue({
                                r: BigInt(sig.r),
                                s: BigInt(sig.s),
                            }),
                        })),
                    );
                    console.log(
                        `${OK} quorum         reachable (upper-bound check)`,
                    );
                } catch (error) {
                    console.log(`${BAD} quorum         ${message(error)}`);
                    setVerdict(
                        "Quorum is impossible even counting every archived " +
                            "signature as valid — validators are not signing, " +
                            "or their registered Mina keys do not match the " +
                            "set the contract is pinned to.",
                    );
                }
            }
        } catch (error) {
            console.log(`${BAD} ${message(error)}`);
            setVerdict(
                "No validator set reproduces the contract's merkleListRoot — " +
                    "the contract is pinned to a set this chain does not " +
                    "serve (wrong chain, or the set changed without a settle).",
            );
        }
    } else {
        console.log("  skipped — no contract state");
    }

    // ── 5. archive ──────────────────────────────────────────────────────
    // The one input that comes from neither the contract nor the chain. Its
    // failure mode is specific: the account shows a gap the archive has not
    // indexed, which the worker can only wait out.
    section("Archive");
    if (ctx && pendingOnChain) {
        try {
            const packed = await fetchActions(
                ctx.contractAddress,
                Field(getContractActionState(ctx)),
            );
            if (packed.length === 0) {
                console.log(
                    `${WARN} returns no actions although the contract shows a gap`,
                );
                setVerdict(
                    "The contract has pending actions but the archive has not " +
                        "indexed them yet — archive lag. Transient; the worker " +
                        "waits without striking.",
                );
            } else {
                console.log(`${OK} ${packed.length} pending action(s) fetched`);
            }
        } catch (error) {
            console.log(`${BAD} fetch failed: ${message(error)}`);
            setVerdict(
                "The Mina archive is unreachable — reduce cannot build its " +
                    "batch. Transient, but check the endpoint if it persists.",
            );
        }
    } else {
        console.log("  skipped — nothing pending");
    }

    // ── 6. breaker and money ────────────────────────────────────────────
    // Last because these do not stop the pipeline from being CORRECT — they
    // stop it from running. A halted breaker with everything else green is
    // the one state that clears with a Mongo write.
    section("Breaker & fee payer");
    try {
        await initDb();
        const state = await getBridgeState();
        const halted =
            state.txFailCount >= MAX_FAIL_COUNT &&
            ctx !== null &&
            state.txAttemptActionState === getContractActionState(ctx);
        console.log(
            `${halted ? BAD : OK} strikes        ${state.txFailCount}/${MAX_FAIL_COUNT}` +
                (state.txAttemptActionState
                    ? ` on front ${short(state.txAttemptActionState, 10)}`
                    : ""),
        );
        console.log(
            `${state.txAttemptActive ? WARN : OK} in flight      ${state.txAttemptActive}` +
                (state.txAttemptActive
                    ? "  (a live attempt, or one that died mid-proof)"
                    : ""),
        );
        if (halted)
            setVerdict(
                "The circuit breaker is OPEN on the current queue front: the " +
                    "master sleeps 60s per tick and logs " +
                    "master_halted_failed_front. Fix the cause above, then " +
                    "clear it — no restart needed, it re-checks every tick:\n" +
                    `  mongosh "${env.MONGO_URI}/${env.MONGO_DB}" --eval ` +
                    "'db.bridgestates.updateOne({}, {$set:{txFailCount:0}})'",
            );

        const counts = await bridgeTxSenderQ.getJobCounts();
        console.log(
            `  queue          waiting ${counts.waiting ?? 0}, active ` +
                `${counts.active ?? 0}, failed ${counts.failed ?? 0}`,
        );
    } catch (error) {
        console.log(`${WARN} Mongo/Redis check failed: ${message(error)}`);
    }

    try {
        const payer = PrivateKey.fromBase58(env.MINA_PRIVATE_KEY).toPublicKey();
        const account = await fetchAccount({ publicKey: payer });
        const balance = account.account?.balance.toBigInt() ?? 0n;
        const mina = Number(balance) / 1e9;
        // Each reduce attempt costs MINA_FEE and may re-send up to 3 times;
        // the bridge has no balance check of its own, so an empty payer
        // surfaces only as opaque send errors.
        const low = balance < BigInt(env.MINA_FEE) * 10n;
        console.log(
            `${low ? BAD : OK} fee payer      ${payer.toBase58()}  ` +
                `${mina.toFixed(3)} MINA, nonce ${account.account?.nonce.toString() ?? "?"}`,
        );
        if (low)
            setVerdict(
                `The fee payer holds ${mina.toFixed(3)} MINA — fewer than ten ` +
                    "sends. The bridge never checks this itself; it would " +
                    "surface as reduce_tx_rejected and halt after three jobs.",
            );
    } catch (error) {
        console.log(`${WARN} fee payer check failed: ${message(error)}`);
    }

    // ── verdict ─────────────────────────────────────────────────────────
    section("Verdict");
    console.log(
        verdict
            ? `${BAD} ${verdict}`
            : `${OK} Every link checks out. If nothing is happening, the ` +
                  "chain simply has not adjudicated new actions yet — watch " +
                  "the scan cursor above, not the bridge.",
    );
    console.log();
}

main()
    .catch((error) => {
        console.error("\nDoctor failed:", error);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
