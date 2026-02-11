import { Types } from "mongoose";
import { ProofEpochModel } from "./ProofEpoch.js";
import { WORKER_TIMEOUT_MS } from "../../../utils/constants.js";
import logger from "../../../../logger.js";

export async function getProofEpoch(height: number) {
    return ProofEpochModel.findOne({ height });
}

export async function storeProofInProofEpoch(
    height: number,
    proof: Types.ObjectId,
    index: number,
) {
    if (index < 0 || index > 31) {
        throw new Error("Index must be between 0 and 31");
    }

    const update: Record<string, any> = {
        [`proofs.${index}`]: proof,
    };

    if (index > 15) {
        update[`status.${index % 16}`] = "done";
    }

    await ProofEpochModel.findOneAndUpdate({ height }, { $set: update });

    logger.info(
        `Stored proof ${proof.toHexString()} in proof epoch at height ${height} for index ${index}.`,
    );
}

export async function deleteProofEpoch(height: number) {
    await ProofEpochModel.deleteOne({ height });

    logger.info(`Deleted proof epoch at height ${height}.`);
}

export async function incrementFailCount(height: number) {
    await ProofEpochModel.updateOne(
        { height },
        {
            $inc: { failCount: 1 },
            $set: { timeoutAt: new Date(Date.now() + WORKER_TIMEOUT_MS) },
        },
    );
}
