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

// Utils

export async function saveMinaState(
    lastSettledPulsarBlock: number,
): Promise<void> {
    await MinaStateModel.findOneAndUpdate(
        {},
        { lastSettledPulsarBlock },
        { upsert: true, new: true },
    );
}

export async function getMinaState(): Promise<number | null> {
    const state = await MinaStateModel.findOne();
    return state?.lastSettledPulsarBlock ?? null;
}
