import mongoose, { Schema, Document } from "mongoose";
import { VoteExt } from "../../../utils/interfaces";

export interface IBlock extends Document {
    height: number;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
}

const VoteExtSchema = new Schema<VoteExt>(
    {
        index: { type: String, required: true },
        height: { type: Number, required: true },
        validatorAddr: { type: String, required: true },
        signature: { type: String, required: true },
    },
    { _id: false },
);

const BlockSchema = new Schema<IBlock>(
    {
        height: { type: Number, required: true, unique: true, index: true },
        stateRoot: { type: String, required: true },
        validators: [{ type: String }],
        validatorListHash: { type: String, required: true },
        voteExt: [VoteExtSchema],
    },
    { timestamps: true },
);

export const BlockModel = mongoose.model<IBlock>("Block", BlockSchema);
