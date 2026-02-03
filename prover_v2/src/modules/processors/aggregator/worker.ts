import { WithId } from "mongodb";
import { ProofEpochDoc } from "../../db/interfaces";
import { DB } from "../../db";
import { ProofStatus } from "../../db/types";
import { patterns } from "./master";
import logger from "../../../logger";

export async function worker(task: WithId<ProofEpochDoc>) {
    const db = new DB();
    await db.initMongo();

    // Worker logic goes here
    const result = patterns.find((p) => {
        if (
            task.proofs[p.startNode] &&
            task.proofs[p.startNode + 1] &&
            !task.status[p.aggregated]
        ) {
            return true;
        }
        return false;
    });

    if (!result) throw new Error("No valid aggregation pattern found.");

    const aggregation = {
        left: task.proofs[result.startNode],
        right: task.proofs[result.startNode + 1],
        index: result.aggregated,
    };

    // register aggregation proof in db
    await registerAggregatedProofSlot(db, task, aggregation.index);

    const leftProof = await db.getProof(aggregation.left);
    const rightProof = await db.getProof(aggregation.right);

    if (!leftProof || !rightProof) {
        throw new Error("One of the proofs to aggregate is missing.");
    }

    // TODO: generate aggregated proof using leftProof and rightProof
    const aggregatedProof = null;

    // TODO: store aggregated proof in db and update proof epoch
    await db.proofEpochsCol.findOneAndUpdate(
        { height: task.height },
        {
            $set: {
                [`proofs.${16 + aggregation.index}`]: aggregatedProof,
                [`status.${aggregation.index}`]: "done" as ProofStatus,
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${task.height} stored in slot ${16 + aggregation.index}.`,
    );
}

async function registerAggregatedProofSlot(
    db: DB,
    task: WithId<ProofEpochDoc>,
    index: number,
) {
    await db.proofEpochsCol.updateOne(
        { height: task.height },
        {
            $set: {
                [`status.${index}`]: "processing" as ProofStatus,
            },
        },
    );
}
