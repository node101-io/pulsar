import { PublicKey } from "o1js";

import logger from "../../common/logger.js";
import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import { ProofKind } from "../../common/types.js";
import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
} from "../../services/mina/client.js";
import { sendProvedSettlement } from "../../services/mina/settlement.js";
import { PROOF_EPOCH_SIZE } from "../../config/constants.js";
import { SettlerJob } from "../types.js";

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

export async function worker(task: SettlerJob) {
    const epoch = await ProofEpochModel.findOne({ height: task.height });
    if (!epoch) {
        throw new Error(`ProofEpoch at height ${task.height} not found.`);
    }

    if (epoch.kind === "done") {
        logger.info("Skipping settlement for already done epoch", {
            epochHeight: task.height,
            event: "settler_epoch_already_done",
        });
        return;
    }

    // null means the epoch was already settled on Mina during the proving phase
    if (epoch.provedTxJson === null) {
        logger.info(
            "Skipping settlement send — epoch was already settled on Mina during proving",
            {
                epochHeight: task.height,
                event: "settler_epoch_pre_settled",
            },
        );
        await setProofEpochDone(task.height);
        return;
    }

    const ctx = await getMinaContext();
    const epochLastPulsarBlock = epoch.height + PROOF_EPOCH_SIZE;

    await sendProvedSettlement(ctx, epoch.provedTxJson, epochLastPulsarBlock);

    await setProofEpochDone(task.height);
}

async function setProofEpochDone(height: number) {
    const result = await ProofEpochModel.findOneAndUpdate(
        {
            height,
            kind: { $in: ["txSending", "settlement"] as ProofKind[] },
        },
        {
            $set: { kind: "done" as ProofKind },
        },
    );

    if (!result) {
        throw new Error(
            `Proof epoch at height ${height} not found or not in txSending/settlement state.`,
        );
    }

    logger.info("Proof epoch marked as done after settlement", {
        epochHeight: height,
        event: "settler_epoch_done",
    });
}
