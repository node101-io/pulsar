import { createWorker } from "./worker.js";
import { ReducerJob } from "../workerConnection.js";
import { storeProof } from "../db.js";
import {
    SignaturePublicKeyList,
    PrepareBatch,
    SettlementContract,
    GenerateValidateReduceProof,
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
    jobHandler: async ({ data }) => {
        const { includedActions, signaturePubkeyArray } = data;

        const signaturePublicKeyList = SignaturePublicKeyList.fromArray(
            signaturePubkeyArray.map(([signature, publicKey]) => [
                Signature.fromBase58(signature),
                PublicKey.fromBase58(publicKey),
            ])
        );

        const { batch, useActionStack, actionStackProof, publicInput, mask } = await PrepareBatch(
            includedActions,
            settlementContract
        );

        const validateReduceProof = await GenerateValidateReduceProof(
            publicInput,
            signaturePublicKeyList
        );

        const tx = await Mina.transaction({ sender: senderKey.toPublicKey(), fee }, async () => {
            await settlementContract.reduce(
                batch,
                useActionStack!,
                actionStackProof!,
                mask,
                validateReduceProof
            );
        });
    },
});
