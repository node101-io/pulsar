import mongoose, { Schema, Document } from "mongoose";
import { VoteExt } from "../../../utils/interfaces";
import { BlockStatus } from "../../types.js";

export interface IBlock extends Document {
    height: number;
    status: BlockStatus;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
    timeoutAt?: Date;
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
        status: {
            type: String,
            enum: ["waiting", "processing", "done", "failed"],
            default: "waiting",
        },
        stateRoot: { type: String, required: true },
        validators: [{ type: String }],
        validatorListHash: { type: String, required: true },
        voteExt: [VoteExtSchema],
        timeoutAt: { type: Date },
    },
    { timestamps: true },
);

export const BlockModel = mongoose.model<IBlock>("Block", BlockSchema);
