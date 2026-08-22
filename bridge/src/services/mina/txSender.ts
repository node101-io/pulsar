import { Bool, Field, Mina, PrivateKey } from "o1js";
import {
    fetchCheckedAccount,
    waitForTransaction,
    withNodeFailover,
} from "pulsar-contracts/build/src/utils/fetch.js";
import type { ApprovalQuorumProof } from "pulsar-contracts/build/src/ApprovalQuorum.js";
import type { ActionStackProof } from "pulsar-contracts/build/src/ActionStack.js";
import type { Batch } from "pulsar-contracts/build/src/types/PulsarAction.js";
import type { ApprovalVerdicts } from "pulsar-contracts/build/src/types/common.js";
import type { MinaClientContext } from "./client.js";
import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

const MAX_RETRY = 3;

export interface ReduceTxParams {
    ctx: MinaClientContext;
    batch: Batch;
    useActionStack: Bool;
    actionStackProof: ActionStackProof;
    /** Per-slot chain verdicts (was the bridge-chosen mask). */
    verdicts: ApprovalVerdicts;
    /** Approval cursor after the batch — the value reduce writes to slot 4;
     * the quorum proof's commitment forces it to be the fold's real result. */
    cursorAfter: Field;
    /** Quorum proof binding the batch-end approval cursor to a signed root. */
    approvalProof: ApprovalQuorumProof;
    /** Queue front (contract actionState) being reduced — log/telemetry only. */
    fromActionState: string;
}

/**
 * Creates and proves the reduce transaction, returning the serialised proved
 * TX JSON.
 *
 * There is deliberately no "already on-chain" pre-check here: idempotency is
 * structural — the worker rebuilds the batch from the contract's live
 * actionState on every attempt, and the contract rejects any reduce whose
 * fold does not extend its current state.
 */
export async function proveReduceTx(params: ReduceTxParams): Promise<string> {
    const { ctx, batch, useActionStack, actionStackProof, verdicts, cursorAfter, approvalProof, fromActionState } = params;

    const fee = env.MINA_FEE;
    const senderKey = PrivateKey.fromBase58(env.MINA_PRIVATE_KEY);
    const sender = senderKey.toPublicKey();

    await fetchCheckedAccount(sender, "Fee payer fetch");
    await fetchCheckedAccount(ctx.contractAddress, "Contract account fetch");

    const tx = await Mina.transaction({ sender, fee }, async () => {
        await ctx.contract.reduce(
            batch,
            useActionStack,
            actionStackProof,
            verdicts,
            cursorAfter,
            approvalProof,
        );
    });

    await tx.prove();

    logger.info("Reduce TX proved", { fromActionState, event: "reduce_tx_proved" });

    return tx.toJSON();
}

/**
 * Reconstructs a pre-proved TX from JSON, then signs and sends it.
 * Does NOT call tx.prove() — the proof must already be embedded in the JSON.
 */
export async function sendProvedReduceTx(
    ctx: MinaClientContext,
    provedTxJson: string,
    fromActionState: string,
): Promise<void> {
    const senderKey = PrivateKey.fromBase58(env.MINA_PRIVATE_KEY);

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
            // Refresh nonce in case it changed since prove(). Its own walk,
            // NOT nested inside the broadcast walk below — nesting would
            // multiply the walks into up-to-N^2 attempts per try.
            const sender = senderKey.toPublicKey();
            const account = await fetchCheckedAccount(
                sender,
                "Fee payer nonce fetch",
            );
            const currentNonce = account.nonce.toString();

            // The send gets the walk too, and needs it MORE than reads: an
            // endpoint can serve every read flawlessly while its gateway
            // 502s every real sendZkapp body (o1test, 2026-08-22) — without
            // the walk, MAX_RETRY hammered that same endpoint three times
            // and gave up. Rebuilding per attempt keeps lazyAuthorization
            // fresh; re-broadcasting an identical signed tx is a mempool
            // no-op.
            const txHash = await withNodeFailover("Reduce broadcast", async () => {
                const txData = JSON.parse(provedTxJson);
                txData.feePayer.body.nonce = currentNonce;

                const signedTx = Mina.Transaction.fromJSON(txData);
                (signedTx as any).transaction.feePayer.lazyAuthorization = {
                    kind: "lazy-signature",
                };

                const result = await signedTx.sign([senderKey]).send();
                return result.hash;
            });

            logger.info("Reduce TX sent", {
                txHash,
                attempt,
                fromActionState,
                event: "reduce_tx_sent",
            });

            const { success, failureReason } = await waitForTransaction(
                txHash,
                ctx.nodeEndpoint,
            );

            if (success) {
                logger.info("Reduce TX included", {
                    txHash,
                    fromActionState,
                    event: "reduce_tx_included",
                });
                return;
            }

            logger.warn("Reduce TX rejected, retrying", {
                txHash,
                attempt,
                fromActionState,
                failureReason,
                event: "reduce_tx_rejected",
            });
        } catch (error) {
            logger.error("Reduce TX send error", {
                attempt,
                fromActionState,
                error,
                event: "reduce_tx_error",
            });
        }
    }

    throw new Error(`sendProvedReduceTx failed after ${MAX_RETRY} attempts for queue front ${fromActionState}`);
}
