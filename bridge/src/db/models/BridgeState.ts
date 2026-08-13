import mongoose, { Schema, Document } from "mongoose";

// Operational memory the chain cannot hold for us: which queue front we are
// attempting and how often it failed. Everything else the bridge needs comes
// from the chain itself (the contract's actionState vs the account's tip).
export interface IBridgeState extends Document {
    /** Queue front (contract actionState) of the last reduce attempt. */
    txAttemptActionState?: string;
    /**
     * Consecutive non-transient failures against that same front. The worker
     * resets it when the front advances; MAX_FAIL_COUNT halts the master.
     */
    txFailCount: number;
    /**
     * True while proving/sending is in flight — set before proving, cleared
     * on completion or booked failure. Still true at boot means the attempt
     * died mid-flight and is booked as a failure. Deliberate restarts during
     * an attempt also cost a strike — accepted: the counter resets as soon as
     * the front advances, and only three in a row on the same front halt.
     */
    txAttemptActive: boolean;
}

const BridgeStateSchema = new Schema<IBridgeState>({
    txAttemptActionState: { type: String },
    txFailCount: { type: Number, default: 0 },
    txAttemptActive: { type: Boolean, default: false },
});

export const BridgeStateModel = mongoose.model<IBridgeState>(
    "BridgeState",
    BridgeStateSchema,
);

export async function getBridgeState(): Promise<IBridgeState> {
    // Atomic upsert for the singleton — a single process reads and writes it,
    // the upsert only guards the very first boot.
    return BridgeStateModel.findOneAndUpdate(
        {},
        { $setOnInsert: { txFailCount: 0, txAttemptActive: false } },
        { upsert: true, returnDocument: "after" },
    );
}
