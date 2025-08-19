import { AGGREGATE_THRESHOLD, SettlementContract, SettlementProof } from "pulsar-contracts";
import { SubmitJob } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { deleteProof, fetchProof } from "../db.js";
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

createWorker<SubmitJob, void>({
    queueName: "submit",
    maxJobsPerWorker: 10,
    jobHandler: async ({ data }) => {
        const { rangeLow, rangeHigh } = data;

        try {
            const mergedProof = (await fetchProof(
                "settlement",
                rangeLow,
                rangeHigh
            )) as SettlementProof;

            if (
                mergedProof.publicOutput.numberOfSettlementProofs.toBigInt() !==
                BigInt(AGGREGATE_THRESHOLD)
            ) {
                logger.warn(
                    `Proof for blocks ${rangeLow}-${rangeHigh} is not fully merged (${mergedProof.publicOutput.numberOfSettlementProofs.toBigInt()}/${AGGREGATE_THRESHOLD})`
                );
                throw new Error("Proof is not fully merged");
            }

            let contractReady = false;

            while (!contractReady) {
                await fetchAccount({ publicKey: settlementContract.address });

                const onChainBlockHeight = settlementContract.blockHeight.get();
                const onChainMerkleRoot = settlementContract.merkleListRoot.get();
                const onChainStateRoot = settlementContract.stateRoot.get();

                const proofInitialHeight = mergedProof.publicInput.InitialBlockHeight;
                const proofInitialMerkleRoot = mergedProof.publicInput.InitialMerkleListRoot;
                const proofInitialStateRoot = mergedProof.publicInput.InitialStateRoot;

                logger.info(
                    `Checking contract readiness:
                    On-chain: height=${onChainBlockHeight.toString()}, merkleRoot=${onChainMerkleRoot
                        .toString()
                        .slice(0, 10)}, stateRoot=${onChainStateRoot.toString().slice(0, 10)}
                    Proof: height=${proofInitialHeight.toString()}, merkleRoot=${proofInitialMerkleRoot
                        .toString()
                        .slice(0, 10)}, stateRoot=${proofInitialStateRoot.toString().slice(0, 10)}`
                );

                if (
                    onChainBlockHeight.equals(proofInitialHeight).toBoolean() &&
                    onChainMerkleRoot.equals(proofInitialMerkleRoot).toBoolean() &&
                    onChainStateRoot.equals(proofInitialStateRoot).toBoolean()
                ) {
                    contractReady = true;
                    logger.info(`Contract is ready for settlement submission`);
                } else if (onChainBlockHeight.greaterThan(proofInitialHeight).toBoolean()) {
                    logger.warn(
                        `Contract block height (${onChainBlockHeight.toString()}) is past proof initial height (${proofInitialHeight.toString()}). Proof may be stale.`
                    );

                    if (
                        onChainBlockHeight
                            .equals(mergedProof.publicInput.NewBlockHeight)
                            .toBoolean()
                    ) {
                        logger.info(
                            `Settlement already applied for blocks ${rangeLow}-${rangeHigh}`
                        );
                        await deleteProof("settlement", rangeLow, rangeHigh);
                        return;
                    }

                    throw new Error("Proof is stale - contract has moved past this block height");
                } else {
                    logger.info(
                        `Waiting for contract to reach block height ${proofInitialHeight.toString()} (currently at ${onChainBlockHeight.toString()})`
                    );
                }
            }

            if (!contractReady) {
                throw new Error(
                    `Contract did not reach required state. Required block height: ${mergedProof.publicInput.InitialBlockHeight.toString()}`
                );
            }

            logger.info(`Submitting settlement transaction for blocks ${rangeLow}-${rangeHigh}`);

            const tx = await Mina.transaction(
                { sender: senderKey.toPublicKey(), fee },
                async () => {
                    await settlementContract.settle(mergedProof);
                }
            );

            await tx.prove();
            const pendingTransaction = await tx.sign([senderKey]).send();

            logger.info(
                `Settlement transaction sent for blocks ${rangeLow}-${rangeHigh}: ${pendingTransaction.hash}`
            );

            await pendingTransaction.wait();

            logger.info(`Settlement transaction confirmed for blocks ${rangeLow}-${rangeHigh}`);

            await deleteProof("settlement", rangeLow, rangeHigh);

            logger.info(
                `Deleted proof for blocks ${rangeLow}-${rangeHigh} after successful settlement`
            );
        } catch (error) {
            logger.error(
                `Failed to submit settlement for blocks ${rangeLow}-${rangeHigh}: ${error}`
            );
            throw error;
        }
    },
});
