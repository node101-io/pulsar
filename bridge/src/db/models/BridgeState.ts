import mongoose, { Schema, Document } from "mongoose";

export interface IBridgeState extends Document {
    lastSyncedHeight: number;
    lastSubmittedHeight: number;
}

const BridgeStateSchema = new Schema<IBridgeState>({
    lastSyncedHeight: { type: Number, default: 0 },
    lastSubmittedHeight: { type: Number, default: 0 },
});

export const BridgeStateModel = mongoose.model<IBridgeState>(
    "BridgeState",
    BridgeStateSchema,
);

export async function getBridgeState(): Promise<IBridgeState> {
    let state = await BridgeStateModel.findOne();
    if (!state) {
        state = await BridgeStateModel.create({
            lastSyncedHeight: 0,
            lastSubmittedHeight: 0,
        });
    }
    return state;
}
