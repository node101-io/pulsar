import { WithId } from "mongodb";
import { ProofEpochDoc } from "../../db/interfaces";
import { DB } from "../../db";
import { ProofKind, ProofStatus } from "../../db/types";
import logger from "../../../logger";
import { Aggregation } from "./master";
import { PROOF_EPOCH_SIZE } from "../../utils/constants";

export async function worker(
    task: WithId<ProofEpochDoc>,
    aggregation: Aggregation,
) {
    const db = new DB();
    await db.initMongo();

    // register aggregation proof in db
    await registerAggregatedProofSlot(db, task, aggregation.index);

    const leftProof = await db.getProof(aggregation.left);
    const rightProof = await db.getProof(aggregation.right);

    if (!leftProof || !rightProof) {
        throw new Error("One of the proofs to aggregate is missing.");
    }

    // TODO: generate aggregated proof using leftProof and rightProof
    const aggregatedProof = null;

    await db.proofEpochsCol.findOneAndUpdate(
        { height: task.height },
        {
            $set: {
                [`proofs.${PROOF_EPOCH_SIZE + aggregation.index}`]:
                    aggregatedProof,
                [`status.${aggregation.index}`]: "done" as ProofStatus,
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${task.height} stored in slot ${PROOF_EPOCH_SIZE + aggregation.index}.`,
    );
}

async function registerAggregatedProofSlot(
    db: DB,
    task: WithId<ProofEpochDoc>,
    index: number,
) {
    await db.proofEpochsCol
        .updateOne(
            {
                height: task.height,
                [`status.${index}`]: { $ne: "processing" as ProofStatus },
            },
            {
                $set: {
                    kind: "aggregation" as ProofKind,
                    [`status.${index}`]: "processing" as ProofStatus,
                },
            },
        )
        .then((result) => {
            if (!result)
                throw new Error(
                    `Failed to register aggregated proof slot for epoch at height ${task.height}.`,
                );
        });
}
