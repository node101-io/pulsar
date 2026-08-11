/**
 * Pipeline doctor: one-shot diagnosis of where settlement is stuck and why.
 *
 * Walks the same chain a human would: chain tip → contract height → the ONE
 * epoch the contract needs next → that epoch's leaves → their block epochs →
 * their blocks' vote extensions. Prints a VERDICT naming the first blocking
 * link and, where known, the fix. Every section degrades gracefully — a dead
 * dependency becomes a finding, not a crash.
 *
 * Required env: MONGO_URI, PULSAR_GRPC_ENDPOINT, CONTRACT_ADDRESS,
 * MINA_NETWORK. Optional: MINA_PRIVATE_KEY (fee-payer balance check).
 */
import "dotenv/config";
import { PublicKey, PrivateKey, fetchAccount, Mina } from "o1js";
import {
    getLatestHeight,
    grpcCredentials,
    TendermintClient,
} from "pulsar-chain-client";

import { initDb } from "../db/index.js";
import { ProofEpochModel, IProofEpoch } from "../db/models/ProofEpoch.js";
import { BlockEpochModel } from "../db/models/BlockEpoch.js";
import { BlockModel } from "../db/models/Block.js";
import { MinaStateModel } from "../db/models/MinaState.js";
import {
    type MinaNetwork,
    initMinaClientContext,
    getContractBlockHeight,
} from "../services/mina/client.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
    PROOF_EPOCH_LEAF_COUNT,
    PROOF_EPOCH_SIZE,
    STALE_CLAIM_TIMEOUT_MS,
    SETTLER_STALL_TIMEOUT_MS,
    SETTLER_WINDOW,
    VOTE_EXT_PERSISTENCE_LAG,
} from "../config/constants.js";
import { epochLastPulsarBlock } from "../common/epoch.js";

const OK = "✓";
const WARN = "⚠";
const BAD = "✗";

function age(date: Date | null | undefined): string {
    if (!date) return "?";
    const s = Math.round((Date.now() - date.getTime()) / 1000);
    if (s < 120) return `${s}s`;
    if (s < 7200) return `${Math.round(s / 60)}m`;
    return `${(s / 3600).toFixed(1)}h`;
}

function section(title: string) {
    console.log(`\n── ${title} ${"─".repeat(Math.max(1, 60 - title.length))}`);
}

let verdict: string | null = null;
function setVerdict(v: string) {
    if (!verdict) verdict = v;
}

async function main() {
    await initDb();

    // ── heights ─────────────────────────────────────────────────────────
    section("Heights");
    let chainTip: number | null = null;
    let contractHeight: number | null = null;

    try {
        const endpoint = process.env.PULSAR_GRPC_ENDPOINT || "localhost:9090";
        const tm = new TendermintClient(endpoint, grpcCredentials(endpoint));
        chainTip = await getLatestHeight(tm);
        console.log(`${OK} pulsar chain tip     : ${chainTip}`);
    } catch (e) {
        console.log(`${BAD} pulsar gRPC unreachable: ${(e as Error).message}`);
        setVerdict("Pulsar gRPC unreachable — nothing can sync or prove.");
    }

    try {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        if (!contractAddress) throw new Error("CONTRACT_ADDRESS is not set");
        const network: MinaNetwork =
            (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";
        const ctx = await initMinaClientContext(
            PublicKey.fromBase58(contractAddress),
            network,
        );
        contractHeight = await getContractBlockHeight(ctx);
        console.log(`${OK} contract blockHeight : ${contractHeight}`);
    } catch (e) {
        console.log(`${BAD} Mina contract unreadable: ${(e as Error).message}`);
        setVerdict("Mina endpoint/contract unreadable — cannot confirm settles.");
    }

    if (chainTip !== null && contractHeight !== null) {
        const gap = chainTip - contractHeight;
        console.log(
            `  gap                  : ${gap} blocks (${(gap / PROOF_EPOCH_SIZE).toFixed(1)} epochs)`,
        );
    }

    // ── fee payer ───────────────────────────────────────────────────────
    section("Fee payer");
    try {
        const pk = process.env.MINA_PRIVATE_KEY;
        if (!pk) {
            console.log(`${WARN} MINA_PRIVATE_KEY not set — skipping`);
        } else {
            const pub = PrivateKey.fromBase58(pk).toPublicKey();
            await fetchAccount({ publicKey: pub });
            const account = Mina.getAccount(pub);
            const mina = Number(account.balance.toString()) / 1e9;
            const marker = mina < 2 ? BAD : mina < 10 ? WARN : OK;
            console.log(`${marker} balance              : ${mina.toFixed(2)} MINA`);
            console.log(`  ledger nonce         : ${account.nonce.toString()}`);
            if (mina < 2)
                setVerdict(
                    "Fee payer nearly empty — settles will stop; top up from the faucet.",
                );
        }
        const state = await MinaStateModel.findOne();
        console.log(`  pipeline lastSentNonce: ${state?.lastSentNonce ?? "null"}`);
    } catch (e) {
        console.log(`${WARN} fee payer check failed: ${(e as Error).message}`);
    }

    // ── pipeline distribution ───────────────────────────────────────────
    section("Pipeline distribution");
    const kinds: {
        _id: string;
        n: number;
        minH: number;
        maxH: number;
    }[] = await ProofEpochModel.aggregate([
        {
            $group: {
                _id: "$kind",
                n: { $sum: 1 },
                minH: { $min: "$height" },
                maxH: { $max: "$height" },
            },
        },
    ]);
    for (const k of kinds.sort((a, b) => a.minH - b.minH)) {
        console.log(
            `  ProofEpoch ${k._id.padEnd(11)}: ${String(k.n).padStart(4)}  [${k.minH} .. ${k.maxH}]`,
        );
    }
    const statuses: { _id: string; n: number }[] =
        await BlockEpochModel.aggregate([
            { $group: { _id: "$epochStatus", n: { $sum: 1 } } },
        ]);
    console.log(
        `  BlockEpoch           : ` +
            statuses.map((s) => `${s._id} ${s.n}`).join(" | "),
    );

    // ── the epoch the contract needs next ───────────────────────────────
    if (contractHeight !== null) {
        const nextHeight = contractHeight + 1;
        section(`Next settleable epoch: ${nextHeight}`);
        const next = await ProofEpochModel.findOne({ height: nextHeight });

        if (!next) {
            const ingestible =
                chainTip !== null &&
                chainTip >=
                    epochLastPulsarBlock(nextHeight) + VOTE_EXT_PERSISTENCE_LAG;
            if (!ingestible) {
                console.log(
                    `${OK} not created yet — chain has not produced/persisted its blocks; healthy`,
                );
            } else {
                console.log(
                    `${BAD} document missing although its blocks exist on-chain`,
                );
                setVerdict(
                    "Next epoch was never ingested/grouped — check pulsar-main sync logs.",
                );
            }
        } else {
            console.log(`  kind: ${next.kind}  failCount: ${next.failCount}  updated: ${age(next.updatedAt)} ago`);
            await diagnoseEpoch(next, chainTip);
        }
    }

    // ── in-flight settles ───────────────────────────────────────────────
    const sent = await ProofEpochModel.find({ kind: "txSent" }).sort({
        height: 1,
    });
    if (sent.length > 0) {
        section("In-flight settle txs");
        for (const e of sent) {
            const a = e.sentAt ? Date.now() - e.sentAt.getTime() : 0;
            const marker = a > SETTLER_STALL_TIMEOUT_MS ? WARN : OK;
            console.log(
                `${marker} epoch ${e.height} nonce ${e.sentNonce} sent ${age(e.sentAt)} ago  ${e.sentTxHash}`,
            );
        }
        console.log(
            `  window: ${sent.length}/${SETTLER_WINDOW}  (stall reset after ${SETTLER_STALL_TIMEOUT_MS / 60000}m)`,
        );
    }

    // ── systemic wedges, anywhere ───────────────────────────────────────
    section("Known failure classes");

    const failedEpochs = await BlockEpochModel.find({ epochStatus: "failed" });
    for (const be of failedEpochs) {
        const owningProofEpoch =
            EPOCH_START_HEIGHT +
            Math.floor((be.height - EPOCH_START_HEIGHT) / PROOF_EPOCH_SIZE) *
                PROOF_EPOCH_SIZE;
        console.log(
            `${BAD} block epoch ${be.height} FAILED (failCount ${be.failCount}) — settle chain will hit it at proof epoch ${owningProofEpoch}`,
        );
        const blocks = await BlockModel.find(
            { height: { $gte: be.height, $lt: be.height + BLOCK_EPOCH_SIZE } },
            { height: 1, voteExt: 1 },
        ).sort({ height: 1 });
        for (const b of blocks) {
            const n = (b.voteExt ?? []).length;
            console.log(
                `    block ${b.height}: ${n} vote ext(s) ${n < 2 ? "← quorum impossible" : ""}`,
            );
        }
        console.log(
            `    recover: clear voteExt + restart pulsar-main (backfill refetches):\n` +
                `    db.blocks.updateMany({height:{$gte:${be.height},$lt:${be.height + BLOCK_EPOCH_SIZE}}},{$set:{voteExt:[]}})`,
        );
        setVerdict(
            `Block epoch ${be.height} fails proving repeatedly (likely bad/missing signatures) — recover per "Known failure classes".`,
        );
    }

    const cutoff = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS);
    const staleClaims = await ProofEpochModel.countDocuments({
        kind: { $in: ["txProving", "txSending"] },
        updatedAt: { $lt: cutoff },
    });
    const staleProcessing = await BlockEpochModel.countDocuments({
        epochStatus: "processing",
        updatedAt: { $lt: cutoff },
    });
    if (staleClaims + staleProcessing > 0) {
        console.log(
            `${WARN} ${staleClaims + staleProcessing} stale claim(s) — the sweep resets these within a minute; persistent ones mean a dead/looping worker`,
        );
    }

    // done block epoch + missing leaf (the 70441 class) — sweep auto-heals
    const heads = await ProofEpochModel.find({
        kind: { $in: ["blockProof", "aggregation"] },
    });
    for (const pe of heads) {
        for (let leaf = 0; leaf < PROOF_EPOCH_LEAF_COUNT; leaf++) {
            if (pe.proofs[leaf]) continue;
            const beHeight = pe.height + leaf * BLOCK_EPOCH_SIZE;
            const be = await BlockEpochModel.findOne({ height: beHeight });
            if (be?.epochStatus === "done") {
                console.log(
                    `${WARN} block epoch ${beHeight} done but leaf ${leaf} of proof epoch ${pe.height} is empty — reconciliation re-queues it within ~${STALE_CLAIM_TIMEOUT_MS / 60000}m`,
                );
            }
        }
    }

    if (failedEpochs.length === 0 && staleClaims + staleProcessing === 0) {
        console.log(`${OK} none detected`);
    }

    // ── verdict ─────────────────────────────────────────────────────────
    section("VERDICT");
    console.log(verdict ?? `${OK} no blocking problem found — if settles still lag, it is throughput, not a wedge (scale provers / check gap trend with pnpm run gap)`);

    process.exit(0);
}

/** Explains why the next settleable epoch has not settled yet. */
async function diagnoseEpoch(epoch: IProofEpoch, chainTip: number | null) {
    const leaves = epoch.proofs
        .slice(0, PROOF_EPOCH_LEAF_COUNT)
        .map((p) => (p ? "ok" : "MISSING"));
    const merges = epoch.proofs
        .slice(PROOF_EPOCH_LEAF_COUNT)
        .map((p) => (p ? "ok" : "-"));

    switch (epoch.kind) {
        case "blockProof":
        case "aggregation": {
            console.log(`  leaves: [${leaves.join(", ")}]  merges: [${merges.join(", ")}]`);
            let blocked = false;
            for (let leaf = 0; leaf < PROOF_EPOCH_LEAF_COUNT; leaf++) {
                if (epoch.proofs[leaf]) continue;
                const beHeight = epoch.height + leaf * BLOCK_EPOCH_SIZE;
                const be = await BlockEpochModel.findOne({ height: beHeight });
                if (!be) {
                    const ready =
                        chainTip !== null &&
                        chainTip >= beHeight + BLOCK_EPOCH_SIZE + VOTE_EXT_PERSISTENCE_LAG;
                    console.log(
                        `  leaf ${leaf} ← block epoch ${beHeight}: not grouped yet${ready ? " (chain HAS its blocks — sync behind?)" : " (healthy, chain not there yet)"}`,
                    );
                    if (ready) {
                        setVerdict("Sync is behind — check pulsar-main logs.");
                        blocked = true;
                    }
                } else if (be.epochStatus === "failed") {
                    console.log(
                        `${BAD}  leaf ${leaf} ← block epoch ${beHeight}: FAILED (failCount ${be.failCount})`,
                    );
                    setVerdict(
                        `Leaf proving fails for block epoch ${beHeight} — see "Known failure classes".`,
                    );
                    blocked = true;
                } else if (be.epochStatus === "done") {
                    console.log(
                        `${WARN}  leaf ${leaf} ← block epoch ${beHeight}: done but leaf empty (wedge — reconciliation re-queues within ~${STALE_CLAIM_TIMEOUT_MS / 60000}m)`,
                    );
                    setVerdict(
                        `Wedged leaf for block epoch ${beHeight} — auto-heals via leaf_reconciliation; watch block-prover logs.`,
                    );
                    blocked = true;
                } else {
                    console.log(
                        `  leaf ${leaf} ← block epoch ${beHeight}: ${be.epochStatus} (updated ${age(be.updatedAt)} ago) — proving in progress`,
                    );
                }
            }
            if (!blocked && leaves.every((l) => l === "ok")) {
                setVerdict(
                    "All leaves present — aggregator is merging (or stuck: check aggregator logs if this persists).",
                );
            } else if (!blocked) {
                setVerdict("Leaf proofs in progress — block-prover is working; throughput question, not a wedge.");
            }
            break;
        }
        case "txProving":
            console.log(`  settlement tx is being proved (updated ${age(epoch.updatedAt)} ago)`);
            setVerdict(
                Date.now() - epoch.updatedAt.getTime() > STALE_CLAIM_TIMEOUT_MS
                    ? "txProving is stale — the sweep will reset it; check settlement-prover logs for crashes."
                    : "Settlement tx proving in progress — normal.",
            );
            break;
        case "settlement":
            console.log(`  proved and waiting for the settler to claim it`);
            setVerdict(
                "Epoch is proved but unclaimed — check settler logs (window full? queue stuck?).",
            );
            break;
        case "txSending":
            console.log(`  claimed by the settler, broadcast imminent`);
            setVerdict("Settler is sending — normal unless this persists.");
            break;
        case "txSent":
            console.log(
                `  broadcast ${age(epoch.sentAt)} ago as nonce ${epoch.sentNonce} (${epoch.sentTxHash}) — waiting for Mina inclusion`,
            );
            setVerdict(
                "Waiting for Mina to include the settle tx — normal; the stall timer re-sends if it died.",
            );
            break;
        case "done":
            console.log(`${WARN} marked done but the contract has not passed it — inconsistent`);
            setVerdict("Next epoch marked done while contract is behind it — inspect manually.");
            break;
    }
}

main().catch((error) => {
    console.error("doctor failed:", error);
    process.exit(1);
});
