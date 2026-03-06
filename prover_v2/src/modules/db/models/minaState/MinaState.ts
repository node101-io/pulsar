import mongoose, { Schema, Document } from "mongoose";

export interface IMinaState extends Document {
    lastSettledPulsarBlock: number;
}

const MinaStateSchema = new Schema<IMinaState>(
    {
        lastSettledPulsarBlock: { type: Number, required: true },
    },
    { timestamps: true },
);

export const MinaStateModel = mongoose.model<IMinaState>(
    "MinaState",
    MinaStateSchema,
);
