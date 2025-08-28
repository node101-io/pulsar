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
    maxJobsPerWorker: 40,
    jobHandler: async ({ data, id }) => {
        const { rangeLow, rangeHigh } = data;

        try {
            logger.jobStarted(id, "submit", {
                rangeLow,
                rangeHigh,
                blockRange: `${rangeLow}-${rangeHigh}`,
                workerId: "submitWorker",
            });

            logger.debug("Fetching merged proof for submission", {
                jobId: id,
                rangeLow,
                rangeHigh,
                event: "fetching_merged_proof",
            });

            const mergedProof = (await fetchProof(
                "settlement",
                rangeLow,
                rangeHigh
            )) as SettlementProof;

            if (
                mergedProof.publicOutput.numberOfSettlementProofs.toBigInt() !==
                BigInt(AGGREGATE_THRESHOLD)
            ) {
                const error = new Error("Proof is not fully merged");
                logger.warn("Proof is not fully merged", {
                    jobId: id,
                    rangeLow,
                    rangeHigh,
                    currentProofs: mergedProof.publicOutput.numberOfSettlementProofs
                        .toBigInt()
                        .toString(),
                    requiredProofs: AGGREGATE_THRESHOLD,
                    event: "proof_not_fully_merged",
                });
                throw error;
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

                logger.debug("Comparing on-chain state with proof requirements", {
                    jobId: id,
                    onChain: {
                        height: onChainBlockHeight.toString(),
                        merkleRoot: onChainMerkleRoot.toString().slice(0, 10),
                        stateRoot: onChainStateRoot.toString().slice(0, 10),
                    },
                    proof: {
                        height: proofInitialHeight.toString(),
                        merkleRoot: proofInitialMerkleRoot.toString().slice(0, 10),
                        stateRoot: proofInitialStateRoot.toString().slice(0, 10),
                    },
                    event: "state_comparison",
                });

                if (
                    onChainBlockHeight.equals(proofInitialHeight).toBoolean() &&
                    onChainMerkleRoot.equals(proofInitialMerkleRoot).toBoolean() &&
                    onChainStateRoot.equals(proofInitialStateRoot).toBoolean()
                ) {
                    contractReady = true;
                    logger.info("Contract is ready for settlement submission", {
                        jobId: id,
                        rangeLow,
                        rangeHigh,
                        event: "contract_ready",
                    });
                } else if (onChainBlockHeight.greaterThan(proofInitialHeight).toBoolean()) {
                    logger.warn("Contract block height is past proof initial height", {
                        jobId: id,
                        onChainBlockHeight: onChainBlockHeight.toString(),
                        proofInitialHeight: proofInitialHeight.toString(),
                        event: "proof_potentially_stale",
                    });

                    if (
                        onChainBlockHeight
                            .equals(mergedProof.publicInput.NewBlockHeight)
                            .toBoolean()
                    ) {
                        logger.info("Settlement already applied, cleaning up proof", {
                            jobId: id,
                            rangeLow,
                            rangeHigh,
                            event: "settlement_already_applied",
                        });
                        await deleteProof("settlement", rangeLow, rangeHigh);
                        return;
                    }

                    throw new Error("Proof is stale - contract has moved past this block height");
                } else {
                    logger.debug("Waiting for contract to reach required block height", {
                        jobId: id,
                        requiredHeight: proofInitialHeight.toString(),
                        currentHeight: onChainBlockHeight.toString(),
                        waitTimeMs: 10000,
                        event: "waiting_for_contract_height",
                    });
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                }
            }

            if (!contractReady) {
                throw new Error(
                    `Contract did not reach required state. Required block height: ${mergedProof.publicInput.InitialBlockHeight.toString()}`
                );
            }

            logger.info("Submitting settlement transaction", {
                jobId: id,
                rangeLow,
                rangeHigh,
                event: "submitting_settlement_transaction",
            });

            const tx = await Mina.transaction(
                { sender: senderKey.toPublicKey(), fee },
                async () => {
                    await settlementContract.settle(mergedProof);
                }
            );

            await tx.prove();
            const pendingTransaction = await tx.sign([senderKey]).send();

            logger.contractInteraction("settle", pendingTransaction.hash, {
                jobId: id,
                rangeLow,
                rangeHigh,
                event: "settlement_transaction_sent",
            });

            await pendingTransaction.wait();

            logger.contractInteraction("settle_confirmed", pendingTransaction.hash, {
                jobId: id,
                rangeLow,
                rangeHigh,
                event: "settlement_transaction_confirmed",
            });

            await deleteProof("settlement", rangeLow, rangeHigh);

            logger.dbOperation("proof_cleanup", "settlement", undefined, {
                jobId: id,
                rangeLow,
                rangeHigh,
                event: "proof_deleted_after_settlement",
            });

            logger.jobCompleted(id, "submit", 0, {
                rangeLow,
                rangeHigh,
                txHash: pendingTransaction.hash,
                workerId: "submitWorker",
            });
        } catch (error) {
            logger.jobFailed(id, "submit", error as Error, {
                rangeLow,
                rangeHigh,
                workerId: "submitWorker",
            });
            throw error;
        }
    },
});
