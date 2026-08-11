import {
    PROOF_EPOCH_SETTLEMENT_INDEX,
    WORKER_COUNT,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    STALE_CLAIM_TIMEOUT_MS,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../config/constants.js";
import { ProofKind } from "../../common/types.js";
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";
import { Master } from "../master.js";
import { settlementProverQ } from "../queue.js";
import { SettlementProverJob } from "../types.js";
import { connection } from "../redis.js";
import { worker as processSettlementProof } from "./worker.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";

// Every kind at or past tx proving. "txSent" matters: a broadcast epoch still
// holds its root proof, and reclaiming it here re-proved and re-sent the same
// settle with a fresh nonce — every duplicate then failed its preconditions
// on-chain and burned its fee (live incident: nonces 13/14/17 mirroring 11/16).
const EXCLUDED_KINDS: ProofKind[] = [
    "txProving",
    "settlement",
    "txSending",
    "txSent",
    "done",
];

export class SettlementProverMaster extends Master<SettlementProverJob> {
    constructor() {
        super({
            queueName: "settlement-prover",
            workerLabel: "Settlement-prover",
            connection,
            workerCount: WORKER_COUNT,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processSettlementProof(job.data);
            },
            onJobFailed: async (job) => {
                if (job?.data.height !== undefined) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async recoverStaleClaims(): Promise<void> {
        // txProving writes nothing while tx.prove() runs, so updatedAt
        // stays at claim time — the cutoff must exceed the slowest settle
        // proving. Age-gated so sibling instances never steal live work.
        const cutoff = new Date(Date.now() - STALE_CLAIM_TIMEOUT_MS);
        const result = await ProofEpochModel.updateMany(
            { kind: "txProving" as ProofKind, updatedAt: { $lt: cutoff } },
            { $set: { kind: "blockProof" as ProofKind } },
        );
        if (result.modifiedCount > 0) {
            logger.warn(
                `Recovered ${result.modifiedCount} stale 'txProving' epoch(s) back to 'blockProof'`,
                { count: result.modifiedCount, event: "tx_proving_recovery" },
            );
        }
    }

    protected async handleTask(): Promise<void> {
        // Lowest height first: settlement consumes epochs in chain order, so
        // proving them out of order only builds a backlog the settler cannot use.
        // The kind transition below is the claim — it is atomic, so two masters
        // can never take the same epoch.
        const epoch = await ProofEpochModel.findOneAndUpdate(
            {
                [`proofs.${PROOF_EPOCH_SETTLEMENT_INDEX}`]: { $ne: null },
                kind: { $nin: EXCLUDED_KINDS },
            },
            {
                $set: { kind: "txProving" as ProofKind },
            },
            {
                sort: { height: 1 },
                returnDocument: "before",
            },
        );

        if (!epoch) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        const settlementProofId = epoch.proofs[PROOF_EPOCH_SETTLEMENT_INDEX];
        if (!settlementProofId) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        try {
            await settlementProverQ.add("settlement-prover", {
                height: epoch.height,
                settlementProofId: settlementProofId.toString(),
            });
            logger.debug(
                `Pushed settlement-prover job to queue for epoch at height ${epoch.height}`,
                { epochHeight: epoch.height, event: "settlement_prover_task_queued" },
            );
        } catch (error) {
            await ProofEpochModel.updateOne(
                { height: epoch.height, kind: "txProving" as ProofKind },
                { $set: { kind: epoch.kind } },
            );
            throw error;
        }
    }
}

export async function masterRunner() {
    const master = new SettlementProverMaster();
    await master.run();
}
