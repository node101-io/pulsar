import mongoose, { Schema, Document } from "mongoose";
import type { MinaActionStatus } from "../../common/types.js";

export interface IMinaAction extends Document {
    blockHeight: number;
    actions: object[];
    status: MinaActionStatus;
    failCount: number;
    createdAt: Date;
}

const MinaActionSchema = new Schema<IMinaAction>(
    {
        blockHeight: { type: Number, required: true, unique: true, index: true },
        actions: { type: [Schema.Types.Mixed], required: true },
        status: {
            type: String,
            enum: ["pending", "submitted", "done", "failed"],
            default: "pending",
            index: true,
        },
        failCount: { type: Number, default: 0 },
    },
    { timestamps: true },
);

export const MinaActionModel = mongoose.model<IMinaAction>(
    "MinaAction",
    MinaActionSchema,
);
