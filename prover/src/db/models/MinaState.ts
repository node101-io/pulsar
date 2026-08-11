import mongoose, { Schema, Document } from "mongoose";

export interface IMinaState extends Document {
    lastSettledPulsarBlock: number;
    // Fee-payer nonce of the last broadcast settle tx. The settler pipelines
    // sends without waiting for inclusion, so the ledger nonce lags behind —
    // the next send uses max(ledgerNonce, lastSentNonce + 1). null = no
    // in-flight pipeline; re-seed from the ledger.
    lastSentNonce: number | null;
}

const MinaStateSchema = new Schema<IMinaState>(
    {
        lastSettledPulsarBlock: { type: Number, required: true },
        lastSentNonce: { type: Number, default: null },
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
        { upsert: true, returnDocument: "after" },
    );
}

export async function getMinaState(): Promise<number | null> {
    const state = await MinaStateModel.findOne();
    return state?.lastSettledPulsarBlock ?? null;
}

export async function getLastSentNonce(): Promise<number | null> {
    const state = await MinaStateModel.findOne();
    return state?.lastSentNonce ?? null;
}

export async function saveLastSentNonce(nonce: number): Promise<void> {
    await MinaStateModel.findOneAndUpdate(
        {},
        { lastSentNonce: nonce },
        { upsert: true, returnDocument: "after" },
    );
}

/** Forgets the pipeline nonce so the next send re-seeds from the ledger. */
export async function resetLastSentNonce(): Promise<void> {
    await MinaStateModel.findOneAndUpdate(
        {},
        { lastSentNonce: null },
        { upsert: true, returnDocument: "after" },
    );
}
