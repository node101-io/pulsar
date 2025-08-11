import {
    AGGREGATE_THRESHOLD,
    MergeSettlementProofs,
    SettlementContract,
    SettlementProof,
} from "pulsar-contracts";
import { MergeJob } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { deleteProof, fetchProof, storeProof } from "../db.js";
import logger from "../logger.js";
import dotenv from "dotenv";
import { fetchAccount, Mina, PrivateKey, PublicKey } from "o1js";
dotenv.config();

const settlementContractAddress = process.env.CONTRACT_ADDRESS;
const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
const fee = Number(process.env.FEE) || 1e8;
if (!settlementContractAddress || !minaPrivateKey) {
    throw new Error("unspecified environment variables");
}
const settlementContract = new SettlementContract(PublicKey.fromBase58(settlementContractAddress));
const senderKey = PrivateKey.fromBase58(minaPrivateKey);

createWorker<MergeJob, void>({
    queueName: "merge",
    maxJobsPerWorker: 10,
    jobHandler: async ({ data }) => {
        const { lowerBlock, upperBlock } = data;

        if (
            upperBlock.rangeHigh - lowerBlock.rangeLow > AGGREGATE_THRESHOLD ||
            upperBlock.rangeLow !== lowerBlock.rangeHigh
        ) {
            logger.warn(
                `invalid merge job: upper : ${upperBlock.rangeLow} - ${upperBlock.rangeHigh}, lower: ${lowerBlock.rangeLow} - ${lowerBlock.rangeHigh}`
            );
            throw new Error(`Invalid merge job`);
        }

        try {
            const lowerProof = (await fetchProof(
                "settlement",
                lowerBlock.rangeLow,
                lowerBlock.rangeHigh
            )) as SettlementProof;
            const upperProof = (await fetchProof(
                "settlement",
                upperBlock.rangeLow,
                upperBlock.rangeHigh
            )) as SettlementProof;

            const mergeProof = await MergeSettlementProofs([lowerProof, upperProof]);

            await storeProof(lowerBlock.rangeLow, upperBlock.rangeHigh, "settlement", mergeProof);
            logger.info(
                `Merged settlement proofs for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
            );
            await deleteProof("settlement", lowerBlock.rangeLow, lowerBlock.rangeHigh);
            await deleteProof("settlement", upperBlock.rangeLow, upperBlock.rangeHigh);

            logger.info(
                `Deleted old proofs for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
            );

            await fetchAccount({ publicKey: settlementContract.address });

            const tx = await Mina.transaction(
                { sender: senderKey.toPublicKey(), fee },
                async () => {
                    await settlementContract.settle(mergeProof);
                }
            );

            await tx.prove();
            await tx.sign([senderKey]).send();

            logger.info(
                `Merge transaction sent successfully for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
            );
        } catch (e) {
            logger.error(`Failed merge: ${e}`);
            throw e;
        }
    },
});
