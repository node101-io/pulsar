import { Types } from "mongoose";
import { ProofEpochModel } from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof } from "../../db/models/proof/utils.js";
import { SettlementContract, SettlementProof } from "pulsar-contracts";
import { Mina, PublicKey, fetchAccount } from "o1js";
import dotenv from "dotenv";
import logger from "../../../logger.js";
import { SettlerJob } from "../utils/jobs.js";

dotenv.config();

export async function worker(task: SettlerJob) {
    const epoch = await ProofEpochModel.findOne({ height: task.height });
    if (!epoch) {
        throw new Error(`ProofEpoch at height ${task.height} not found.`);
    }

    // Idempotency: skip if already settled
    if (epoch.settled) {
        logger.info(
            `Skipping settlement for epoch at height ${task.height} because it is already settled.`,
        );
        return;
    }

    const settlementProofId = new Types.ObjectId(task.settlementProofId);
    const settlementProofJson = await getProof(settlementProofId);

    if (!settlementProofJson) {
        throw new Error("Settlement proof is missing.");
    }

    const settlementProof = await SettlementProof.fromJSON(settlementProofJson);

    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        throw new Error(
            "Contract address is not specified in environment variables",
        );
    }

    Mina.setActiveInstance(
        Mina.Network({
            mina: `${process.env.REMOTE_SERVER_URL}:8080/graphql`,
            archive: `${process.env.REMOTE_SERVER_URL}:8282`,
        }),
    );

    const contractInstance = new SettlementContract(
        PublicKey.fromBase58(contractAddress),
    );

    await fetchAccount({ publicKey: contractInstance.address });

    await contractInstance.settle(settlementProof);

    logger.info(
        `Settlement proof for epoch at height ${task.height} submitted to the contract.`,
    );

    await ProofEpochModel.updateOne(
        { height: task.height },
        { $set: { settled: true } },
    );

    logger.info(
        `Proof epoch at height ${task.height} marked as settled.`,
    );
}
