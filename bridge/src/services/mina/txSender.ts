import { Bool, fetchAccount, Mina, PrivateKey } from "o1js";
import type { Proof } from "o1js";
import { waitForTransaction } from "../../../../contracts/build/src/utils/fetch.js";
import type { ValidateReducePublicInput } from "../../../../contracts/build/src/ValidateReduce.js";
import type { ActionStackProof } from "../../../../contracts/build/src/ActionStack.js";
import type { Batch } from "../../../../contracts/build/src/types/PulsarAction.js";
import type { ReduceMask } from "../../../../contracts/build/src/types/common.js";
import type { MinaClientContext } from "./client.js";
import { getContractBlockHeight } from "./client.js";
import logger from "../../common/logger.js";

const MAX_RETRY = 3;

export interface ReduceTxParams {
    ctx: MinaClientContext;
    batch: Batch;
    useActionStack: Bool;
    actionStackProof: ActionStackProof;
    mask: ReduceMask;
    validateReduceProof: Proof<ValidateReducePublicInput, void>;
    /** The Mina block height up to which this batch covers — used for on-chain skip check. */
    upToMinaHeight: number;
}

/**
 * Creates and proves the reduce transaction.
 * Returns the serialised proved TX JSON, or null if the contract has
 * already processed this height on-chain (safe to skip).
 */
export async function proveReduceTx(params: ReduceTxParams): Promise<string | null> {
    const { ctx, batch, useActionStack, actionStackProof, mask, validateReduceProof, upToMinaHeight } = params;

    const contractHeight = await getContractBlockHeight(ctx);
    if (contractHeight >= upToMinaHeight) {
        logger.info("Reduce TX skipped — already processed on-chain", {
            upToMinaHeight,
            contractHeight,
            event: "reduce_tx_skipped",
        });
        return null;
    }

    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const fee = Number(process.env.MINA_FEE ?? 1e8);
    const senderKey = PrivateKey.fromBase58(privateKeyBase58);
    const sender = senderKey.toPublicKey();

    await fetchAccount({ publicKey: sender });
    await fetchAccount({ publicKey: ctx.contractAddress });

    const tx = await Mina.transaction({ sender, fee }, async () => {
        await ctx.contract.reduce(
            batch,
            useActionStack,
            actionStackProof,
            mask,
            validateReduceProof,
        );
    });

    await tx.prove();

    logger.info("Reduce TX proved", { upToMinaHeight, event: "reduce_tx_proved" });

    return tx.toJSON();
}

/**
 * Reconstructs a pre-proved TX from JSON, then signs and sends it.
 * Does NOT call tx.prove() — the proof must already be embedded in the JSON.
 * Returns early if the contract has already processed this height on-chain.
 */
export async function sendProvedReduceTx(
    ctx: MinaClientContext,
    provedTxJson: string,
    upToMinaHeight: number,
): Promise<void> {
    const contractHeight = await getContractBlockHeight(ctx);
    if (contractHeight >= upToMinaHeight) {
        logger.info("Reduce TX send skipped — already processed on-chain", {
            upToMinaHeight,
            contractHeight,
            event: "reduce_tx_send_skipped",
        });
        return;
    }

    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const senderKey = PrivateKey.fromBase58(privateKeyBase58);

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
            // Refresh nonce in case it changed since prove()
            const sender = senderKey.toPublicKey();
            await fetchAccount({ publicKey: sender });
            const currentNonce = Mina.getAccount(sender).nonce.toString();

            const txData = JSON.parse(provedTxJson);
            txData.feePayer.body.nonce = currentNonce;

            const signedTx = Mina.Transaction.fromJSON(txData);
            (signedTx as any).transaction.feePayer.lazyAuthorization = {
                kind: "lazy-signature",
            };

            const result = await signedTx.sign([senderKey]).send();
            const txHash = result.hash;

            logger.info("Reduce TX sent", {
                txHash,
                attempt,
                upToMinaHeight,
                event: "reduce_tx_sent",
            });

            const { success, failureReason } = await waitForTransaction(
                txHash,
                ctx.nodeEndpoint,
            );

            if (success) {
                logger.info("Reduce TX included", {
                    txHash,
                    upToMinaHeight,
                    event: "reduce_tx_included",
                });
                return;
            }

            logger.warn("Reduce TX rejected, retrying", {
                txHash,
                attempt,
                upToMinaHeight,
                failureReason,
                event: "reduce_tx_rejected",
            });
        } catch (error) {
            logger.error("Reduce TX send error", {
                attempt,
                upToMinaHeight,
                error,
                event: "reduce_tx_error",
            });
        }
    }

    throw new Error(`sendProvedReduceTx failed after ${MAX_RETRY} attempts for height ${upToMinaHeight}`);
}
