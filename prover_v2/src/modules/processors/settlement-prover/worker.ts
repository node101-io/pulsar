import { Types } from "mongoose";
import { PublicKey } from "o1js";
import { SettlementProof } from "pulsar-contracts";

import logger from "../../../logger.js";
import { ProofEpochModel } from "../../db/models/proofEpoch/ProofEpoch.js";
import { getProof } from "../../db/models/proof/utils.js";
import { ProofKind } from "../../db/types.js";
import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
} from "../../mina/client.js";
import { proveSettlementTx } from "../../mina/settlement.js";
import { BLOCK_EPOCH_SIZE } from "../../utils/constants.js";
import { SettlementProverJob } from "../utils/jobs.js";

let minaCtx: MinaClientContext | null = null;

async function getMinaContext(): Promise<MinaClientContext> {
    if (!minaCtx) {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error("CONTRACT_ADDRESS is not set");
        }
        const network: MinaNetwork =
            (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";
        minaCtx = await initMinaClientContext(
            PublicKey.fromBase58(contractAddress),
            network,
        );
    }
    return minaCtx;
}

export async function worker(task: SettlementProverJob): Promise<void> {
    const epoch = await ProofEpochModel.findOne({ height: task.height });
    if (!epoch) {
        throw new Error(`ProofEpoch at height ${task.height} not found.`);
    }

    if (
        epoch.kind === "settlement" ||
        epoch.kind === "txSending" ||
        epoch.kind === "done"
    ) {
        logger.info("Skipping tx proving for epoch already past txProving stage", {
            epochHeight: task.height,
            kind: epoch.kind,
            event: "settlement_prover_epoch_already_advanced",
        });
        return;
    }

    const settlementProofId = new Types.ObjectId(task.settlementProofId);
    const settlementProofJson = await getProof(settlementProofId);
    if (!settlementProofJson) {
        throw new Error("Settlement proof is missing.");
    }

    const settlementProof = await SettlementProof.fromJSON(settlementProofJson);
    const ctx = await getMinaContext();

    const epochLastPulsarBlock = epoch.height + BLOCK_EPOCH_SIZE - 1;

    const provedTxJson = await proveSettlementTx(
        ctx,
        settlementProof,
        epochLastPulsarBlock,
    );

    await setProofEpochSettlement(task.height, provedTxJson);
}

async function setProofEpochSettlement(
    height: number,
    provedTxJson: string | null,
): Promise<void> {
    const result = await ProofEpochModel.findOneAndUpdate(
        {
            height,
            kind: "txProving" as ProofKind,
        },
        {
            $set: {
                kind: "settlement" as ProofKind,
                provedTxJson,
            },
        },
    );

    if (!result) {
        throw new Error(
            `Proof epoch at height ${height} not found or not in txProving state.`,
        );
    }

    logger.info("Proof epoch marked as settlement-ready after tx proving", {
        epochHeight: height,
        alreadySettled: provedTxJson === null,
        event: "settlement_prover_epoch_ready",
    });
}
