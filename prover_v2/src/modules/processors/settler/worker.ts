import { Types } from "mongoose";
import { ProofEpochModel } from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof } from "../../db/models/proof/utils.js";
import { ProofKind } from "../../db/types.js";
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

    if (epoch.failCount > 0 && epoch.kind === "done") {
        logger.info(
            `Skipping settlement for epoch at height ${task.height} because it is already marked as done.`,
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

    await contractInstance
        .settle(settlementProof)
        .then(async () => {
            logger.info(
                `Settlement proof for epoch at height ${task.height} submitted to the contract.`,
            );

            await setProofEpochDone(task.height);
        })
        .catch((error) => {
            logger.error(
                `Failed to submit settlement proof for epoch at height ${task.height}: ${error}`,
            );
            throw error;
        });
}

async function setProofEpochDone(height: number) {
    const result = await ProofEpochModel.findOneAndUpdate(
        {
            height,
            kind: "settlement" as ProofKind,
        },
        {
            $set: {
                kind: "done" as ProofKind,
            },
        },
    );

    if (!result) {
        throw new Error(
            `Proof epoch at height ${height} not found or not in settlement state.`,
        );
    }

    logger.info(
        `Proof epoch at height ${height} marked as done after settlement.`,
    );
}
