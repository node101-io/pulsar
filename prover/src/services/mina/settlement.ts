import { Mina, PrivateKey, Transaction } from "o1js";
import {
    fetchCheckedAccount,
    GenerateSettleAttestProof,
    SettlementProof,
    withNodeFailover,
} from "pulsar-contracts";

import logger from "../../common/logger.js";
import { getContractBlockHeight, type MinaClientContext } from "./client.js";

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

    await fetchCheckedAccount(senderPublicKey, "Fee payer fetch");

    // The settle branch verifies the small SettleAttest adapter, not the
    // settlement proof itself (o1js wrap-bug workaround — SettleAttest.ts).
    const attestProof = await GenerateSettleAttestProof(proof);
    const tx = await Mina.transaction(
        { sender: senderPublicKey, fee },
        async () => {
            await ctx.settlementContract.settle(proof.publicInput, attestProof);
        },
    );

    await tx.prove();

    logger.info("Settlement TX proved", {
        epochLastPulsarBlock,
        event: "mina_settlement_tx_proved",
    });

    return tx.toJSON();
}

/** Ledger nonce of the fee payer derived from MINA_PRIVATE_KEY. */
export async function fetchFeePayerLedgerNonce(): Promise<number> {
    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const senderPublicKey =
        PrivateKey.fromBase58(privateKeyBase58).toPublicKey();
    const account = await fetchCheckedAccount(
        senderPublicKey,
        "Fee payer nonce fetch",
    );
    return Number(account.nonce.toString());
}

/**
 * Reconstructs a pre-proved transaction from JSON, re-signs it with the GIVEN
 * fee-payer nonce and broadcasts it. Does NOT call tx.prove() and does NOT
 * wait for inclusion — the settler pipelines sends and confirms them later by
 * watching the contract's blockHeight advance. Returns the tx hash.
 */
export async function broadcastProvedSettlement(
    provedTxJson: string,
    nonce: number,
    epochLastPulsarBlock: number,
): Promise<string> {
    const privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
    if (!privateKeyBase58) throw new Error("MINA_PRIVATE_KEY is not set");

    const sender = PrivateKey.fromBase58(privateKeyBase58);

    // The whole attempt sits inside the node failover, and sends need that
    // walk MORE than reads do: an endpoint can serve every read flawlessly
    // while its gateway 502s every real sendZkapp body (o1test, 2026-08-22),
    // so a healthy sticky read instance proves nothing about broadcast. The
    // tx is rebuilt and re-signed per attempt; re-broadcasting the same
    // signed tx to a second node is safe — same hash, a duplicate is a
    // mempool no-op.
    const result = await withNodeFailover("Settlement broadcast", async () => {
        const txData = JSON.parse(provedTxJson);
        txData.feePayer.body.nonce = String(nonce);

        const tx = Transaction.fromJSON(txData);
        (tx as any).transaction.feePayer.lazyAuthorization = {
            kind: "lazy-signature",
        };
        const sent = await tx.sign([sender]).send();

        if ((sent as { status?: string }).status === "rejected") {
            throw new Error(
                `Settlement broadcast rejected by the node: ${JSON.stringify(
                    (sent as { errors?: unknown }).errors ?? "unknown",
                )}`,
            );
        }
        return sent;
    });

    logger.info("Settlement TX broadcast", {
        txHash: result.hash,
        nonce,
        epochLastPulsarBlock,
        event: "mina_settlement_tx_broadcast",
    });

    return result.hash;
}
