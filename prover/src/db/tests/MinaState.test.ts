import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveMinaState, getMinaState, MinaStateModel } from "../models/MinaState.js";

describe("db minaState utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("saveMinaState", () => {
        it("upserts lastSettledPulsarBlock", async () => {
            vi.spyOn(MinaStateModel, "findOneAndUpdate").mockResolvedValue({} as any);

            await saveMinaState(800);

            expect(MinaStateModel.findOneAndUpdate).toHaveBeenCalledWith(
                {},
                { lastSettledPulsarBlock: 800 },
                { upsert: true, new: true },
            );
        });

        it("upserts with value 0", async () => {
            vi.spyOn(MinaStateModel, "findOneAndUpdate").mockResolvedValue({} as any);

            await saveMinaState(0);

            expect(MinaStateModel.findOneAndUpdate).toHaveBeenCalledWith(
                {},
                { lastSettledPulsarBlock: 0 },
                { upsert: true, new: true },
            );
        });
    });

    describe("getMinaState", () => {
        it("returns lastSettledPulsarBlock when state exists", async () => {
            vi.spyOn(MinaStateModel, "findOne").mockResolvedValue({
                lastSettledPulsarBlock: 800,
            } as any);

            const result = await getMinaState();

            expect(MinaStateModel.findOne).toHaveBeenCalled();
            expect(result).toBe(800);
        });

        it("returns null when no state found", async () => {
            vi.spyOn(MinaStateModel, "findOne").mockResolvedValue(null as any);

            const result = await getMinaState();

            expect(result).toBeNull();
        });

        it("returns 0 when lastSettledPulsarBlock is 0", async () => {
            vi.spyOn(MinaStateModel, "findOne").mockResolvedValue({
                lastSettledPulsarBlock: 0,
            } as any);

            const result = await getMinaState();

            expect(result).toBe(0);
        });
    });
});
