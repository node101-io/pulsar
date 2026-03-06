import { MinaStateModel } from "./MinaState.js";

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
