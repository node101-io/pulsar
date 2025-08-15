import { createWorker } from "./worker.js";
import { ReducerJob } from "../workerConnection.js";
import { storeProof } from "../db.js";
import {
    SignaturePublicKeyList,
    PrepareBatchWithActions,
    SettlementContract,
    GenerateValidateReduceProof,
    PulsarAction,
} from "pulsar-contracts";
import logger from "../logger.js";
import { fetchAccount, Mina, PrivateKey, PublicKey, Signature } from "o1js";

const settlementContractAddress = process.env.CONTRACT_ADDRESS;
const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
const fee = Number(process.env.FEE) || 1e8;
if (!settlementContractAddress || !minaPrivateKey) {
    throw new Error("unspecified environment variables");
}
const settlementContract = new SettlementContract(PublicKey.fromBase58(settlementContractAddress));
const senderKey = PrivateKey.fromBase58(minaPrivateKey);

createWorker<ReducerJob, void>({
    queueName: "reduce",
    maxJobsPerWorker: 100,
    jobHandler: async ({ data, id }) => {
        try {
            const { includedActions, signaturePubkeyArray, actions } = data;
            console.log(`Included Actions: ${JSON.stringify(includedActions)}`);
            const includedActionsMap = toIncludedActionsMap(includedActions);
            console.log(
                `Included Actions Map: ${JSON.stringify(Array.from(includedActionsMap.entries()))}`
            );

            const packedActions = actions.map((action) => {
                return {
                    action: PulsarAction.fromRawAction(action.actions[0]),
                    hash: BigInt(action.hash),
                };
            });
            console.log(`Action hash: ${packedActions[0].action.unconstrainedHash().toString()}`);

            const signaturePublicKeyList = SignaturePublicKeyList.fromArray(
                signaturePubkeyArray.map(([signature, publicKey]) => [
                    Signature.fromBase58(signature),
                    PublicKey.fromBase58(publicKey),
                ])
            );

            logger.info(`[Job ${id}] Preparing batch for included actions`);
            await fetchAccount({ publicKey: settlementContract.address });
            const { batch, useActionStack, publicInput, actionStackProof, mask } =
                await PrepareBatchWithActions(
                    includedActionsMap,
                    settlementContract,
                    packedActions
                );

            logger.info(`[Job ${id}] Batch prepared, generating validate reduce proof`);
            console.log(`Public Input: ${JSON.stringify(publicInput.toJSON())}`);
            console.log(
                `Signature Public Key List: ${JSON.stringify(signaturePublicKeyList.toJSON())}`
            );
            const validateReduceProof = await GenerateValidateReduceProof(
                publicInput,
                signaturePublicKeyList
            );

            const tx = await Mina.transaction(
                { sender: senderKey.toPublicKey(), fee },
                async () => {
                    await settlementContract.reduce(
                        batch,
                        useActionStack!,
                        actionStackProof!,
                        mask,
                        validateReduceProof
                    );
                }
            );

            await tx.prove();
            await tx.sign([senderKey]).send();

            logger.info(`[Job ${id}] Reduce transaction sent successfully`);
        } catch (err: any) {
            logger.error(
                `[Job ${id}] Error in reduce worker: ${err?.message || err} \n${err?.stack || ""}`
            );
            throw err;
        }
    },
});

function toIncludedActionsMap(raw: [string, number][]): Map<string, number> {
    const map = new Map<string, number>();
    for (const [hash, count] of raw) {
        map.set(hash, count);
    }
    return map;
}
