import { fileURLToPath } from "node:url";

import logger from "../../common/logger.js";
import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import { runProvingJobInChild } from "../childProver.js";
import { SettlementProverJob } from "../types.js";

// Master side: no o1js here. See workers/childProver.ts.
const PROVE_ENTRY = fileURLToPath(new URL("./prove-main.js", import.meta.url));

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
        logger.info(
            "Skipping tx proving for epoch already past txProving stage",
            {
                epochHeight: task.height,
                kind: epoch.kind,
                event: "settlement_prover_epoch_already_advanced",
            },
        );
        return;
    }

    // The child loads the root proof, proves the settle tx and moves the epoch
    // to 'settlement'; the parent owns only the kind transition that claimed
    // it, which the master's sweep returns to 'blockProof' if this fails.
    await runProvingJobInChild(
        PROVE_ENTRY,
        [String(task.height), task.settlementProofId],
        { epochHeight: task.height },
    );
}
