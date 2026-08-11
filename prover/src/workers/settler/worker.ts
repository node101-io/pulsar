import logger from "../../common/logger.js";
import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import {
    getLastSentNonce,
    saveLastSentNonce,
} from "../../db/models/MinaState.js";
import { ProofKind } from "../../common/types.js";
import {
    broadcastProvedSettlement,
    fetchFeePayerLedgerNonce,
} from "../../services/mina/settlement.js";
import { PROOF_EPOCH_SIZE, SETTLER_WINDOW } from "../../config/constants.js";
import { epochLastPulsarBlock } from "../../common/epoch.js";
import { finalizeSettledEpoch } from "./finalize.js";
import { SettlerJob } from "../types.js";

/**
 * Sends the claimed epoch's proved settle tx and returns WITHOUT waiting for
 * inclusion — the master's confirm loop watches the contract's blockHeight
 * and finalizes sent epochs as the chain passes them. Because a settle tx's
 * preconditions come from its proof (not from live chain state), up to
 * SETTLER_WINDOW txs can be in flight at once, chained by fee-payer nonce.
 */
export async function worker(task: SettlerJob) {
    const epoch = await ProofEpochModel.findOne({ height: task.height });
    if (!epoch) {
        throw new Error(`ProofEpoch at height ${task.height} not found.`);
    }

    // The master may have confirmed, reset or finalized the epoch since this
    // job was queued — a stale job is a no-op, not an error.
    if (epoch.kind !== "txSending") {
        logger.info("Skipping settler job — epoch no longer claimed", {
            epochHeight: task.height,
            kind: epoch.kind,
            event: "settler_job_stale",
        });
        return;
    }

    // null means the epoch was already settled on Mina during proving —
    // there is nothing to send, only storage to reclaim.
    if (epoch.provedTxJson === null) {
        logger.info(
            "Epoch was pre-settled on Mina during proving — finalizing",
            {
                epochHeight: task.height,
                event: "settler_epoch_pre_settled",
            },
        );
        await finalizeSettledEpoch(task.height);
        return;
    }

    // Order guard: this tx's preconditions chain onto the previous epoch's
    // output state, so the predecessor must be settled or in flight. A
    // missing document is fine — either this is the pipeline's first epoch
    // or the predecessor was finalized and TTL-reaped.
    const predecessor = await ProofEpochModel.findOne({
        height: task.height - PROOF_EPOCH_SIZE,
    });
    if (
        predecessor &&
        !(["txSent", "done"] as ProofKind[]).includes(predecessor.kind)
    ) {
        throw new Error(
            `Cannot send epoch ${task.height}: predecessor at ` +
                `${predecessor.height} is "${predecessor.kind}", not settled or in flight`,
        );
    }

    // Window guard: bound the fee burned if an in-flight tx dies (everything
    // behind it fails its preconditions). Hand the claim back — the master
    // re-claims once the window drains.
    const inFlight = await ProofEpochModel.countDocuments({
        kind: "txSent" as ProofKind,
    });
    if (inFlight >= SETTLER_WINDOW) {
        await ProofEpochModel.updateOne(
            { height: task.height, kind: "txSending" as ProofKind },
            { $set: { kind: "settlement" as ProofKind } },
        );
        logger.debug("Send window full, returning epoch to settlement", {
            epochHeight: task.height,
            inFlight,
            window: SETTLER_WINDOW,
            event: "settler_window_full",
        });
        return;
    }

    // The ledger nonce lags while txs are in flight, so the pipeline counts
    // its own: max() re-seeds cleanly after resets and quiet periods.
    const ledgerNonce = await fetchFeePayerLedgerNonce();
    const lastSent = await getLastSentNonce();
    const nonce =
        lastSent === null ? ledgerNonce : Math.max(ledgerNonce, lastSent + 1);

    const txHash = await broadcastProvedSettlement(
        epoch.provedTxJson,
        nonce,
        epochLastPulsarBlock(task.height),
    );

    // Nonce first: if we crash between the two writes, the retried job
    // re-broadcasts with nonce+1 and the stray duplicate fails harmlessly.
    // The reverse order would reuse the nonce and evict our own pending tx.
    await saveLastSentNonce(nonce);
    await ProofEpochModel.updateOne(
        { height: task.height, kind: "txSending" as ProofKind },
        {
            $set: {
                kind: "txSent" as ProofKind,
                sentTxHash: txHash,
                sentNonce: nonce,
                sentAt: new Date(),
            },
        },
    );

    logger.info("Settle tx in flight", {
        epochHeight: task.height,
        txHash,
        nonce,
        inFlight: inFlight + 1,
        event: "settler_tx_in_flight",
    });
}
