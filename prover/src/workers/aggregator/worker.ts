import { fileURLToPath } from "node:url";

import { type IProofEpoch } from "../../db/models/ProofEpoch.js";
import logger from "../../common/logger.js";
import { Aggregation } from "./master.js";
import { runProvingJobInChild } from "../childProver.js";

// Master side: no o1js here. See workers/childProver.ts.
const PROVE_ENTRY = fileURLToPath(new URL("./prove-main.js", import.meta.url));

export async function worker(task: IProofEpoch, aggregation: Aggregation) {
    if (task.failCount > 0 && task.status[aggregation.index] === "done") {
        logger.info(
            `Skipping aggregation for epoch ${task.height}, index ${aggregation.index} because it is already done.`,
        );
        return;
    }

    // The child fetches both inputs, merges them and stores the result in its
    // slot; the parent stays out of the multi-MB proof JSON entirely.
    await runProvingJobInChild(
        PROVE_ENTRY,
        [
            String(task.height),
            aggregation.left.toString(),
            aggregation.right.toString(),
            String(aggregation.index),
        ],
        { epochHeight: task.height, index: aggregation.index },
    );
}
