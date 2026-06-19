import { fetchAccount, Mina, PrivateKey, Transaction } from "o1js";
import { SettlementProof, waitForTransaction } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { getContractBlockHeight, type MinaClientContext } from "./client.js";

const MAX_RETRY_COUNT = 3;

/**
 * creates and proves the Mina settlement transaction
 * returns the serialized proved transaction JSON, or null if the epoch is
 * already settled on-chain
 */
export async function proveSettlementTx(
    ctx: MinaClientContext,
    proof: SettlementProof,
    epochLastPulsarBlock: number,
): Promise<string | null> {
    const contractBlock = await getContractBlockHeight(ctx);
    if (contractBlock >= epochLastPulsarBlock) {
        logger.info("Epoch already settled on Mina, skipping TX proof", {
            epochLastPulsarBlock,
            contractBlockHeight: contractBlock,
            event: "mina_settlement_proof_skipped",
        });
        return null;
    }

    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const fee = Number(process.env.MINA_FEE ?? "100000000");
    const sender = PrivateKey.fromBase58(privateKeyBase58);
    const senderPublicKey = sender.toPublicKey();

    await fetchAccount({ publicKey: senderPublicKey });

    const tx = await Mina.transaction(
        { sender: senderPublicKey, fee },
        async () => {
            await ctx.settlementContract.settle(proof);
        },
    );

    await tx.prove();

    logger.info("Settlement TX proved", {
        epochLastPulsarBlock,
        event: "mina_settlement_tx_proved",
    });

    return tx.toJSON();
}

/**
 * Reconstructs a pre-proved transaction from JSON, then signs and sends it.
 * Does NOT call tx.prove() — the proof must already be embedded in the JSON.
 */
export async function sendProvedSettlement(
    ctx: MinaClientContext,
    provedTxJson: string,
    epochLastPulsarBlock: number,
): Promise<void> {
    const contractBlock = await getContractBlockHeight(ctx);
    if (contractBlock >= epochLastPulsarBlock) {
        logger.info("Epoch already settled on Mina, skipping TX send", {
            epochLastPulsarBlock,
            contractBlockHeight: contractBlock,
            event: "mina_settlement_send_skipped",
        });
        return;
    }

    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const sender = PrivateKey.fromBase58(privateKeyBase58);

    for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
        try {
            // refresh the fee payer nonce so the signature is valid even if
            // the account nonce changed since the TX was proved
            const senderPublicKey = sender.toPublicKey();
            await fetchAccount({ publicKey: senderPublicKey });
            const currentNonce =
                Mina.getAccount(senderPublicKey).nonce.toString();

            const txData = JSON.parse(provedTxJson);
            txData.feePayer.body.nonce = currentNonce;

            const tx = Transaction.fromJSON(txData);
            (tx as any).transaction.feePayer.lazyAuthorization = {
                kind: "lazy-signature",
            };
            const result = await tx.sign([sender]).send();
            const txHash = result.hash;

            logger.info("Settlement TX sent", {
                txHash,
                attempt,
                epochLastPulsarBlock,
                event: "mina_settlement_tx_sent",
            });

            const { success, failureReason } = await waitForTransaction(
                txHash,
                ctx.endpoint,
            );

            if (success) {
                logger.info("Settlement TX included", {
                    txHash,
                    epochLastPulsarBlock,
                    event: "mina_settlement_tx_included",
                });
                return;
            }

            logger.warn("Settlement TX rejected, retrying", {
                txHash,
                attempt,
                failureReason,
                event: "mina_settlement_tx_rejected",
            });
        } catch (error) {
            logger.error("Settlement TX send error", {
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                attempt,
                epochLastPulsarBlock,
                event: "mina_settlement_tx_error",
            });
        }
    }

    throw new Error(
        `Settlement send failed after ${MAX_RETRY_COUNT} attempts for block ${epochLastPulsarBlock}`,
    );
}
