import { ProofEpochModel } from "./ProofEpoch.js";
import logger from "../../../../logger.js";

export async function getProofEpoch(height: number) {
    return ProofEpochModel.findOne({ height });
}

export async function deleteProofEpoch(height: number) {
    await ProofEpochModel.deleteOne({ height });

    logger.info(`Deleted proof epoch at height ${height}.`);
}
