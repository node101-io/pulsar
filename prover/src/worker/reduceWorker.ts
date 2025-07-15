import { createWorker } from "./worker.js";
import { ReducerJob } from "../workerConnection.js";
import { storeProof } from "../db.js";
import {
    SignaturePublicKeyList,
    PrepareBatchWithActions,
    SettlementContract,
    GenerateValidateReduceProof,
    CalculateMax,
    PulsarAction,
} from "pulsar-contracts";
import logger from "../logger.js";
import { Mina, PrivateKey, PublicKey, Signature } from "o1js";

const settlementContractAddress = process.env.SETTLEMENT_CONTRACT_ADDRESS;
const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
const fee = Number(process.env.FEE) || 0.1;
if (!settlementContractAddress || !minaPrivateKey) {
    throw new Error("unspecified environment variables");
}
const settlementContract = new SettlementContract(PublicKey.fromBase58(settlementContractAddress));
const senderKey = PrivateKey.fromBase58(minaPrivateKey);

createWorker<ReducerJob, void>({
    queueName: "reduce",
    // maxJobsPerWorker: 5,
    jobHandler: async ({ data, id }) => {
        try {
            const { includedActions, signaturePubkeyArray, actions } = data;
            const packedActions = actions.map((action) => {
                return {
                    action: PulsarAction.fromRawAction(action.actions[0]),
                    hash: BigInt(action.hash),
                };
            });

            const signaturePublicKeyList = SignaturePublicKeyList.fromArray(
                signaturePubkeyArray.map(([signature, publicKey]) => [
                    Signature.fromBase58(signature),
                    PublicKey.fromBase58(publicKey),
                ])
            );

            // const { batchActions, publicInput } = CalculateMax(
            //     includedActions,
            //     settlementContract,
            //     packedActions
            // );

            logger.info(`[Job ${id}] Preparing batch for included actions`);
            const { batch, useActionStack, publicInput, actionStackProof, mask } =
                await PrepareBatchWithActions(includedActions, settlementContract, packedActions);

            // await storeProof(
            //     Number(publicInput.blockHeight.toString()),
            //     Number(publicInput.blockHeight.toString()),
            //     "actionStack",
            //     actionStackProof!
            // );

            logger.info(`[Job ${id}] Batch prepared, generating validate reduce proof`);
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
