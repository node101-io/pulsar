import { fromHex } from "@cosmjs/encoding";
import {
    DirectSecp256k1Wallet,
    Registry,
    type GeneratedType,
} from "@cosmjs/proto-signing";
import { SigningStargateClient, defaultRegistryTypes } from "@cosmjs/stargate";
import { fetchLastBlock } from "o1js";
import {
    activeNodeEndpoint,
    withNodeFailover,
} from "pulsar-contracts/build/src/utils/fetch.js";
import {
    MSG_PUSH_NEW_ACTIONS_TYPE_URL,
    MsgPushNewActions,
    fetchBridgeParams,
} from "pulsar-chain-client";

import logger from "../../common/logger.js";
import { sleep } from "../../common/sleep.js";
import { env } from "../../config/env.js";
import { fetchActionsBatch, getBridgeQueryClient } from "./actionHashes.js";

// The bridge process owns MsgPushNewActions (decided with the chain team —
// no external cron): the push is the ignition for the chain's adjudication;
// the archive-wrapper behind it is a passive query service. The message is
// height-based and permissionless, so a racing push from anyone else is a
// harmless no-op for us.

export { startPusher, computePushDecision, classifyPushFailure, wrapperMargin };
export type { PushWindow, PushDecision, PushFailureKind };

interface PushWindow {
    /** The chain's current Mina scan cursor (latest_fetched_mina_height). */
    cursor: bigint;
    /** The Mina tip to aim at (already margin-adjusted by the caller). */
    tip: bigint;
    /** params.start_block_height — the chain refuses targets below it. */
    startBlockHeight: bigint;
    /** params.max_block_range — the chain refuses spans above it. */
    maxBlockRange: bigint;
}

type PushDecision =
    | { kind: "push"; target: bigint }
    | { kind: "idle" }
    /**
     * cursor + max_block_range < start_block_height ≤ tip: no admissible
     * target exists and pushing cannot fix it — the genesis bridge state
     * must seed latest_fetched_mina_height near start_block_height, or the
     * range param must grow. Loud, never a quiet idle.
     */
    | { kind: "unreachable_start" };

// Mirrors msg_server_push_new_actions.go's admission checks exactly: the
// target must advance the cursor, sit at or past start_block_height, and
// span at most max_block_range.
function computePushDecision(w: PushWindow): PushDecision {
    const candidate =
        w.tip < w.cursor + w.maxBlockRange ? w.tip : w.cursor + w.maxBlockRange;
    if (candidate <= w.cursor) return { kind: "idle" };
    if (candidate >= w.startBlockHeight)
        return { kind: "push", target: candidate };
    if (w.tip < w.startBlockHeight) return { kind: "idle" };
    return { kind: "unreachable_start" };
}

type PushFailureKind =
    | "raced"
    | "wrapper_behind"
    | "wrapper_down"
    | "config"
    | "chain_invariant"
    | "unknown";

// x/bridge registers its errors at codes ≥1102 and the SDK's ante-level
// codes stay below 100, so with exactly one msg type in the tx the bare code
// is unambiguous — which matters because the shipped pair delivers nothing
// else: cosmjs 0.36 drops the codespace when mapping the tx result, and SDK
// 0.50+ leaves rawLog empty (kept as a last resort for older nodes).
const BRIDGE_ERR_NOT_FINALIZED = 1105; // x/bridge/types/errors.go
const BRIDGE_ERR_MUST_ADVANCE = 1108;
const BRIDGE_CONFIG_ERRS = new Set([
    1107, // invalid mina block height
    1109, // invalid mina block range
    1127, // range exceeds max_block_range
]);
const SDK_ERR_OUT_OF_GAS = 11; // config: retrying the same gas limit fails forever
// Refused in CheckTx, so no fee is taken and nothing drains — the quietest
// possible stall. Without this it would classify as "unknown" and re-send
// the identical underpaid tx every tick, forever.
const SDK_ERR_INSUFFICIENT_FEE = 13;

// The wrapper is down, still catching up, or timed out serving the range.
// Nothing is wrong with our request — the next tick asks again.
const BRIDGE_WRAPPER_ERRS = new Set([
    1115, // wrapper query time-out
    1116, // wrapper query cancelled
    1135, // archive wrapper is not ready
]);

// The chain deliberately fail-fasts the WHOLE push when an action's payload is
// one the SettlementContract cannot have emitted — amount <= 0, an unknown
// type, coordinates that are not a field element. Business-invalid actions (an
// unregistered account, an underfunded withdrawal) are NOT here: those get an
// approved=false leaf and the batch proceeds. These codes mean an upstream
// invariant broke, so halting is the correct answer and the cursor must NOT
// advance past the offending Mina block — consuming it as a false leaf would
// hash a negative amount as 2^64-1 and invent semantics the protocol does not
// define. (Chain team decision, 2026-08-12: PR #40 rejected for exactly this.)
const BRIDGE_INVARIANT_ERRS = new Set([
    1129, // action is nil
    1130, // invalid action block_height
    1131, // invalid action amount
    1132, // invalid action type
    1133, // invalid action x coordinate
]);

function classifyPushFailure(code: number, rawLog = ""): PushFailureKind {
    if (code === BRIDGE_ERR_MUST_ADVANCE) return "raced";
    if (code === BRIDGE_ERR_NOT_FINALIZED) return "wrapper_behind";
    if (BRIDGE_WRAPPER_ERRS.has(code)) return "wrapper_down";
    if (BRIDGE_INVARIANT_ERRS.has(code)) return "chain_invariant";
    if (
        BRIDGE_CONFIG_ERRS.has(code) ||
        code === SDK_ERR_OUT_OF_GAS ||
        code === SDK_ERR_INSUFFICIENT_FEE
    )
        return "config";
    if (rawLog.includes("must advance")) return "raced";
    if (rawLog.includes("not finalized")) return "wrapper_behind";
    if (rawLog.includes("out of gas") || rawLog.includes("insufficient fee"))
        return "config";
    if (rawLog.includes("invalid action")) return "chain_invariant";
    if (rawLog.includes("wrapper")) return "wrapper_down";
    return "unknown";
}

// The archive wrapper serves its "latest CONFIRMED and indexed" height
// (wrapper_query_client.go), which trails the live Mina tip by two distinct
// amounts:
//
//   1. params.confirmation_depth — the chain publishes it, so it is KNOWN.
//      Aiming above it fails "not finalized" on every tick, and each failed
//      push still pays its fee. At the deployed depth of 40, discovering it
//      two blocks at a time would burn 20 rejections before the first
//      success; reading it costs nothing, since pushTick already fetches
//      params for the range bounds.
//   2. the archive node's own indexing lag on top — NOT observable from
//      here, and it drifts. That is what the self-tuning slack absorbs: each
//      rejection widens it a step, a streak of accepted pushes narrows it
//      again so a wrapper that catches up is followed rather than
//      permanently under-shot.
//
// Slack alone (a blind margin) would be wrong now that the depth is
// published, and depth alone would stall the moment the archive node fell
// behind — so the effective target is tip − (depth + slack). Slack is
// process-lifetime state; reset() is the test hook.
const wrapperMargin = {
    slack: 0n,
    streak: 0,
    /** Highest Mina height the wrapper can plausibly have confirmed. */
    effectiveTip(tip: bigint, confirmationDepth: bigint): bigint {
        const lag = confirmationDepth + EDGE_SAFETY + this.slack;
        return tip > lag ? tip - lag : 0n;
    },
    onRejected(): void {
        if (this.slack < MAX_SLACK) this.slack += SLACK_STEP;
        this.streak = 0;
    },
    onApplied(): void {
        if (this.slack > 0n && ++this.streak >= SLACK_DECAY_AFTER) {
            this.slack--;
            this.streak = 0;
        }
    },
    reset(): void {
        this.slack = 0n;
        this.streak = 0;
    },
};

const SLACK_STEP = 2n;
const MAX_SLACK = 64n;
const SLACK_DECAY_AFTER = 10;

// Aim a little INSIDE the confirmed zone rather than at its exact edge. Each
// validator answers PushNewActions from its OWN archive wrapper, inside
// consensus execution (a known pre-production TODO in the keeper), so two
// validators whose indexers differ by a block at the boundary return
// different results for the same transaction — one applies state, the other
// rejects, and the chain halts on an app-hash mismatch. Targeting the exact
// boundary is the pattern most likely to sit on that disagreement, and the
// self-tuning slack would otherwise oscillate across it forever. A couple of
// blocks of standoff costs minutes of latency and removes the whole class.
const EDGE_SAFETY = 3n;

// One push per tick is plenty: a push spans up to max_block_range (1000)
// Mina blocks and Mina produces ~one block per 3 min, so even a week-long
// pusher outage catches up in a handful of ticks.
async function pushTick(
    client: SigningStargateClient,
    address: string,
): Promise<void> {
    const params = (await fetchBridgeParams(getBridgeQueryClient())).params;
    if (!params?.start_block_height || !params?.max_block_range)
        throw new Error(
            "x/bridge Query/Params served no start_block_height/max_block_range",
        );
    // confirmation_depth may legitimately be absent or "0" on a chain that
    // does not delay the wrapper; the slack alone then covers the lag.
    const confirmationDepth = BigInt(params.confirmation_depth ?? "0");

    const tip = await withNodeFailover("Mina tip fetch", async () =>
        (
            await fetchLastBlock(activeNodeEndpoint(env.MINA_NETWORK))
        ).blockchainLength.toBigint(),
    );

    const decision = computePushDecision({
        cursor: (await fetchActionsBatch()).latestFetchedMinaHeight,
        tip: wrapperMargin.effectiveTip(tip, confirmationDepth),
        startBlockHeight: BigInt(params.start_block_height),
        maxBlockRange: BigInt(params.max_block_range),
    });
    if (decision.kind === "idle") return;
    if (decision.kind === "unreachable_start") {
        logger.error(
            "Push deadlock: cursor + max_block_range cannot reach " +
                "start_block_height — the genesis bridge state must seed " +
                "latest_fetched_mina_height near start_block_height, or " +
                "max_block_range must grow. Report to the chain team.",
            { params, event: "push_unreachable_start" },
        );
        return;
    }

    const result = await client.signAndBroadcast(
        address,
        [
            {
                typeUrl: MSG_PUSH_NEW_ACTIONS_TYPE_URL,
                value: MsgPushNewActions.fromPartial({
                    creator: address,
                    mina_block_height: decision.target.toString(),
                }),
            },
        ],
        {
            amount: [
                {
                    denom: env.PULSAR_FEE_DENOM,
                    amount: String(env.PULSAR_FEE_AMOUNT),
                },
            ],
            gas: String(env.PULSAR_GAS_LIMIT),
        },
    );

    if (result.code === 0) {
        wrapperMargin.onApplied();
        logger.info("Pushed new actions", {
            target: decision.target.toString(),
            wrapperSlack: wrapperMargin.slack.toString(),
            txHash: result.transactionHash,
            event: "push_new_actions_sent",
        });
        return;
    }

    const failure = classifyPushFailure(result.code, result.rawLog);
    const meta = {
        target: decision.target.toString(),
        code: result.code,
        event: `push_${failure}`,
    };
    if (failure === "wrapper_behind") {
        wrapperMargin.onRejected();
        logger.debug("Push behind the wrapper, widening tip margin", {
            ...meta,
            wrapperSlack: wrapperMargin.slack.toString(),
        });
    } else if (failure === "raced") {
        logger.debug("Push not applied (benign race)", meta);
    } else if (failure === "wrapper_down") {
        logger.warn(
            "Push refused: the archive wrapper is unavailable or still " +
                "catching up. Nothing is wrong with the request — the next " +
                "tick asks again. Persisting means the wrapper or its Mina " +
                "archive database needs attention.",
            meta,
        );
    } else if (failure === "chain_invariant") {
        logger.error(
            "Push refused: the Mina interval carries an action the contract " +
                "cannot have emitted, so the chain fail-fasts and the cursor " +
                "stays put — BY DESIGN. Adjudication is halted until the " +
                "source is fixed; retrying cannot clear it. Inspect the " +
                "actions the archive wrapper serves for this interval.",
            { ...meta, rawLog: result.rawLog },
        );
    } else {
        logger.error("Push rejected", { ...meta, rawLog: result.rawLog });
    }
}

/**
 * Runs forever alongside the reduce master. Enabled only when both
 * PULSAR_RPC_ENDPOINT and PULSAR_PRIVATE_KEY_HEX are set; exactly one is a
 * boot error so a typo cannot silently turn adjudication off. Per-tick
 * failures (chain restarting, RPC down, flaky Mina endpoint) are logged and
 * retried next tick — the loop itself never dies.
 */
async function startPusher(): Promise<void> {
    const endpoint = env.PULSAR_RPC_ENDPOINT;
    const keyHex = env.PULSAR_PRIVATE_KEY_HEX;
    if (!endpoint && !keyHex) {
        logger.info(
            "Action pusher disabled (no PULSAR_RPC_ENDPOINT / PULSAR_PRIVATE_KEY_HEX)",
            { event: "pusher_disabled" },
        );
        return;
    }
    if (!endpoint || !keyHex)
        throw new Error(
            "Half-configured pusher: PULSAR_RPC_ENDPOINT and " +
                "PULSAR_PRIVATE_KEY_HEX must be set together",
        );

    const wallet = await DirectSecp256k1Wallet.fromKey(fromHex(keyHex), "pulsar");
    const [account] = await wallet.getAccounts();
    const client = await SigningStargateClient.connectWithSigner(
        endpoint,
        wallet,
        {
            registry: new Registry([
                ...defaultRegistryTypes,
                // Reflection-boundary cast: ts-proto's exact-typed create()
                // does not fit cosmjs's looser GeneratedType; the members the
                // Registry actually calls (encode/decode/fromPartial) match.
                [
                    MSG_PUSH_NEW_ACTIONS_TYPE_URL,
                    MsgPushNewActions as unknown as GeneratedType,
                ],
            ]),
        },
    );
    logger.info("Action pusher started", {
        address: account.address,
        intervalMs: env.PUSH_INTERVAL_MS,
        event: "pusher_started",
    });

    while (true) {
        try {
            await pushTick(client, account.address);
        } catch (error) {
            logger.warn("Push tick failed, retrying next interval", {
                error: error instanceof Error ? error.message : String(error),
                event: "push_tick_failed",
            });
        }
        await sleep(env.PUSH_INTERVAL_MS);
    }
}
