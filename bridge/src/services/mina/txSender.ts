import { Bool, fetchAccount, Mina, PrivateKey } from "o1js";
import type { Proof } from "o1js";
import { waitForTransaction } from "../../../../contracts/build/src/utils/fetch.js";
import type { ValidateReducePublicInput } from "../../../../contracts/build/src/ValidateReduce.js";
import type { ActionStackProof } from "../../../../contracts/build/src/ActionStack.js";
import type { Batch } from "../../../../contracts/build/src/types/PulsarAction.js";
import type { ReduceMask } from "../../../../contracts/build/src/types/common.js";
import type { MinaClientContext } from "./client.js";
import logger from "../../common/logger.js";

const MAX_RETRY = 3;

export interface ReduceTxParams {
    ctx: MinaClientContext;
    batch: Batch;
    useActionStack: Bool;
    actionStackProof: ActionStackProof;
    mask: ReduceMask;
    validateReduceProof: Proof<ValidateReducePublicInput, void>;
}

export async function sendReduceTx(params: ReduceTxParams): Promise<void> {
    const { ctx, batch, useActionStack, actionStackProof, mask, validateReduceProof } = params;

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

    logger.info("Reduce TX proved", { event: "reduce_tx_proved" });

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
            // refresh nonce in case it changed since prove()
            await fetchAccount({ publicKey: sender });
            const currentNonce = Mina.getAccount(sender).nonce.toString();

            const txData = JSON.parse(tx.toJSON());
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
                event: "reduce_tx_sent",
            });

            const { success, failureReason } = await waitForTransaction(
                txHash,
                ctx.nodeEndpoint,
            );

            if (success) {
                logger.info("Reduce TX included", {
                    txHash,
                    event: "reduce_tx_included",
                });
                return;
            }

            logger.warn("Reduce TX rejected, retrying", {
                txHash,
                attempt,
                failureReason,
                event: "reduce_tx_rejected",
            });
        } catch (error) {
            logger.error("Reduce TX send error", {
                attempt,
                error,
                event: "reduce_tx_error",
            });
        }
    }

    throw new Error(`sendReduceTx failed after ${MAX_RETRY} attempts`);
}
