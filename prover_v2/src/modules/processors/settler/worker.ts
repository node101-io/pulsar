import {
    type IProofEpoch,
    ProofEpochModel,
} from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof } from "../../db/models/proof/utils.js";
import { ProofKind } from "../../db/types.js";
import { SettlementContract, SettlementProof } from "pulsar-contracts";
import { Mina, PublicKey, fetchAccount } from "o1js";
import dotenv from "dotenv";
import logger from "../../../logger.js";
import { PROOF_EPOCH_SETTLEMENT_INDEX } from "../../utils/constants.js";

dotenv.config();

export async function worker(task: IProofEpoch) {
    await registerProofEpoch(task);

    const settlementProofId = task.proofs[PROOF_EPOCH_SETTLEMENT_INDEX];

    if (!settlementProofId) {
        throw new Error("Settlement proof ID is missing.");
    }

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

async function registerProofEpoch(task: IProofEpoch) {
    const result = await ProofEpochModel.findOneAndUpdate(
        {
            height: task.height,
            kind: { $ne: "settlement" as ProofKind },
        },
        {
            $set: {
                kind: "settlement" as ProofKind,
            },
        },
    );

    if (!result) {
        throw new Error(
            `Proof epoch at height ${task.height} is already registered as settlement.`,
        );
    }

    logger.info(
        `Registered proof epoch at height ${task.height} as settlement.`,
    );
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
