import { fileURLToPath } from "node:url";

import {
    ProofEpochModel,
    BlockEpochModel,
    BlockModel,
} from "../../db/index.js";
import { BlockStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { BlockProverJob } from "../types.js";
import { runProvingJobInChild } from "../childProver.js";
import { proofEpochHeightFor, leafIndexFor } from "./helpers.js";

// Master side: no o1js here. See workers/childProver.ts.
const PROVE_ENTRY = fileURLToPath(new URL("./prove-main.js", import.meta.url));

export async function worker(task: BlockProverJob) {
    const { height: epochHeight, blockIndex } = task;
    const blockHeight = epochHeight + blockIndex;

    // Mark the individual Block as done
    await BlockModel.findOneAndUpdate(
        { height: blockHeight },
        { $set: { status: "done" as BlockStatus } },
    );

    const updatedEpoch = await BlockEpochModel.findOneAndUpdate(
        { height: epochHeight, epochStatus: "processing" as BlockStatus },
        { $set: { [`status.${blockIndex}`]: "done" as BlockStatus } },
        { returnDocument: "after" },
    );

    if (!updatedEpoch) {
        logger.warn(
            `BlockEpoch ${epochHeight} not found or not in processing state, skipping block ${blockHeight}`,
        );
        return;
    }

    logger.info(
        `Block ${blockHeight} (index ${blockIndex}) marked done in epoch ${epochHeight}`,
        { epochHeight, blockIndex, blockHeight, event: "block_marked_done" },
    );

    const allDone = (updatedEpoch.status as string[]).every(
        (s) => s === "done",
    );
    if (!allDone) return;

    logger.info(
        `All blocks done for epoch ${epochHeight}, generating settlement proof`,
        { epochHeight, event: "all_blocks_done" },
    );

    // Re-runs happen after failures and BullMQ redeliveries. If THIS block
    // epoch's leaf is already in the proof epoch, only the done-mark was
    // lost — restore it without re-proving. The check must target our OWN
    // leaf slot: an any-slot check here once marked an epoch done while its
    // own leaf was still missing, wedging the proof epoch (and the whole
    // settle chain behind it) in blockProof forever.
    const proofEpoch = await ProofEpochModel.findOne({
        height: proofEpochHeightFor(epochHeight),
    });
    if (proofEpoch?.proofs[leafIndexFor(epochHeight)]) {
        logger.info(
            `Leaf proof for epoch ${epochHeight} already stored — marking done without re-proving`,
            { epochHeight, event: "leaf_already_stored" },
        );
        await BlockEpochModel.findOneAndUpdate(
            { height: epochHeight },
            { $set: { epochStatus: "done" as BlockStatus } },
        );
        return;
    }

    // The child stores the leaf and marks the epoch done; the parent only
    // owns the claim, so all it has to undo here is the claim itself.
    try {
        await runProvingJobInChild(PROVE_ENTRY, [String(epochHeight)], {
            epochHeight,
        });
    } catch (err) {
        await BlockEpochModel.findOneAndUpdate(
            { height: epochHeight },
            { $set: { epochStatus: "waiting" as BlockStatus } },
        );
        throw err;
    }
}
