import { WithId } from "mongodb";
import { ProofEpochDoc } from "../../db/interfaces";
import { DB } from "../../db";
import { SettlementContract } from "pulsar-contracts";
import { Mina, PublicKey, fetchAccount } from "o1js";
import dotenv from "dotenv";
import { ProofKind } from "../../db/types";
import logger from "../../../logger";

dotenv.config();

export async function worker(task: WithId<ProofEpochDoc>) {
    const db = new DB();
    await db.initMongo();

    await registerProofEpoch(task);

    const proofEpoch = await db.proofEpochsCol.findOne({ height: task.height });
    const settlementProofId = proofEpoch?.proofs[30];

    if (!settlementProofId) {
        throw new Error("Settlement proof ID is missing.");
    }

    const settlementProof = await db.getProof(settlementProofId);

    if (!settlementProof) {
        throw new Error("Settlement proof is missing.");
    }

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

    // TODO: check if type of sefflementProof suits the settle function
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

async function registerProofEpoch(task: WithId<ProofEpochDoc>) {
    const db = new DB();
    await db.initMongo();

    await db.proofEpochsCol
        .findOneAndUpdate(
            {
                height: task.height,
                kind: { $ne: "settlement" as ProofKind },
            },
            {
                $set: {
                    kind: "settlement" as ProofKind,
                },
            },
        )
        .then((result) => {
            if (!result) {
                throw new Error(
                    `Proof epoch at height ${task.height} is already registered as settlement.`,
                );
            }

            logger.info(
                `Registered proof epoch at height ${task.height} as settlement.`,
            );
        });
}

async function setProofEpochDone(height: number) {
    const db = new DB();
    await db.initMongo();

    await db.proofEpochsCol
        .findOneAndUpdate(
            {
                height: height,
                kind: "settlement" as ProofKind,
            },
            {
                $set: {
                    kind: "done" as ProofKind,
                },
            },
        )
        .then((result) => {
            if (!result) {
                throw new Error(
                    `Proof epoch at height ${height} not found or not in settlement state.`,
                );
            }
            logger.info(
                `Proof epoch at height ${height} marked as done after settlement.`,
            );
        });
}
