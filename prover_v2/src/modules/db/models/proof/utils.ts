import { Types } from "mongoose";
import { ProofModel } from "./Proof.js";
import logger from "../../../../logger.js";

export async function storeProof(data: string): Promise<Types.ObjectId> {
    const doc = await ProofModel.create({ data });

    logger.info(`Stored proof with id ${doc._id.toHexString()}.`);
    return doc._id as Types.ObjectId;
}

export async function getProof(id: Types.ObjectId) {
    const proof = await ProofModel.findById(id);

    if (!proof || !proof.data) throw new Error("Proof not found");

    logger.info(`Retrieved proof with id ${id.toHexString()}.`);
    return JSON.parse(proof.data);
}

export async function deleteProof(id: Types.ObjectId) {
    await ProofModel.deleteOne({ _id: id });

    logger.info(`Deleted proof with id ${id.toHexString()}.`);
}
