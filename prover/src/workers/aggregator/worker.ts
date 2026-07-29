import {
    type IProofEpoch,
    ProofEpochModel,
} from "../../db/models/ProofEpoch.js";
import { getProof, storeProof } from "../../db/models/Proof.js";
import { ProofStatus } from "../../common/types.js";
import logger from "../../common/logger.js";
import { Aggregation } from "./master.js";
import { PROOF_EPOCH_LEAF_COUNT } from "../../config/constants.js";
import { MergeSettlementProofs, SettlementProof, MultisigVerifierProgram } from "pulsar-contracts";
import type { JsonProof } from "o1js";

let compiled = false;
let compileLock: Promise<void> = Promise.resolve();
async function ensureCompiled() {
    // `compiled` is only set after the await, so without this lock every worker
    // that arrives before the first compile finishes starts its own.
    compileLock = compileLock.then(async () => {
        if (!compiled) {
            await MultisigVerifierProgram.compile();
            compiled = true;
        }
    });
    await compileLock;
}

// o1js keeps a single global proving context per process, so concurrent prove
// calls corrupt each other — measured: running this stage unserialized turned a
// clean run into 148 "global context reached an inconsistent state" failures
// and halved throughput, because the failures are retried. The other two
// proving stages already serialize; this one runs WORKER_COUNT workers, so it
// needs the same.
let provingQueue: Promise<void> = Promise.resolve();
function serializeProving<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        provingQueue = provingQueue.then(() => fn().then(resolve, reject));
    });
}

export async function worker(task: IProofEpoch, aggregation: Aggregation) {
    if (task.failCount > 0 && task.status[aggregation.index] === "done") {
        logger.info(
            `Skipping aggregation for epoch ${task.height}, index ${aggregation.index} because it is already done.`,
        );
        return;
    }

    const leftProofJson = await getProof(aggregation.left);
    const rightProofJson = await getProof(aggregation.right);

    if (!leftProofJson || !rightProofJson) {
        throw new Error("One of the proofs to aggregate is missing.");
    }

    const aggregatedProofJson = await serializeProving(async () => {
        await ensureCompiled();
        return generateAggregatedProof(leftProofJson, rightProofJson);
    });

    const aggregatedProofId = await storeProof(aggregatedProofJson);

    if (!aggregatedProofId) {
        throw new Error("Failed to store aggregated proof.");
    }

    const proofSlotIndex = PROOF_EPOCH_LEAF_COUNT + aggregation.index;

    await ProofEpochModel.findOneAndUpdate(
        { height: task.height },
        {
            $set: {
                [`proofs.${proofSlotIndex}`]: aggregatedProofId,
                [`status.${aggregation.index}`]: "done" as ProofStatus,
            },
        },
    );

    logger.info(
        `Aggregated proof for epoch at height ${task.height} stored in slot ${proofSlotIndex}.`,
        {
            aggregatedProofId: aggregatedProofId.toHexString(),
            index: proofSlotIndex,
            event: "aggregated_proof_stored",
        },
    );
}

async function generateAggregatedProof(
    leftJson: JsonProof,
    rightJson: JsonProof,
): Promise<string> {
    const left = await SettlementProof.fromJSON(leftJson);
    const right = await SettlementProof.fromJSON(rightJson);

    const merged = await MergeSettlementProofs([left, right]);

    return JSON.stringify(merged.toJSON());
}
