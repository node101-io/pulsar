import { fetchAccount, Mina, PrivateKey } from "o1js";
import { SettlementProof, waitForTransaction } from "pulsar-contracts";

import logger from "../../logger.js";
import { getContractBlockHeight, type MinaClientContext } from "./client.js";

const MAX_RETRY_COUNT = 3;

export async function submitSettlement(
    ctx: MinaClientContext,
    proof: SettlementProof,
    epochLastPulsarBlock: number,
): Promise<void> {
    // check if already settled by another prover node
    const contractBlock = await getContractBlockHeight(ctx);
    if (contractBlock >= epochLastPulsarBlock) {
        logger.info("Epoch already settled on Mina, skipping TX", {
            epochLastPulsarBlock,
            contractBlockHeight: contractBlock,
            event: "mina_settlement_skipped",
        });
        return;
    }

    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const fee = Number(process.env.MINA_FEE ?? "100000000");
    const sender = PrivateKey.fromBase58(privateKeyBase58);
    const senderPublicKey = sender.toPublicKey();

    for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
        try {
            await fetchAccount({ publicKey: senderPublicKey });

            const tx = await Mina.transaction(
                { sender: senderPublicKey, fee },
                async () => {
                    await ctx.settlementContract.settle(proof);
                },
            );

            await tx.prove();
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
            logger.error("Settlement TX error", error as Error, {
                attempt,
                epochLastPulsarBlock,
                event: "mina_settlement_tx_error",
            });
        }
    }

    throw new Error(
        `Settlement failed after ${MAX_RETRY_COUNT} attempts for block ${epochLastPulsarBlock}`,
    );
}
