import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";
import { initDb } from "./db.js";
import { seedInitialBlocks } from "./models/block/utils.js";

vi.mock("mongoose");
vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock("./models/block/utils.js", () => ({
    seedInitialBlocks: vi.fn(),
}));

describe("db initDb", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it("connects to MongoDB with MONGO_URI and calls seedInitialBlocks", async () => {
        process.env.MONGO_URI = "mongodb://test-uri";
        process.env.MONGO_DB = "testdb";

        const connectMock = vi
            .mocked(mongoose.connect)
            .mockResolvedValue({} as any);

        const { initDb: freshInitDb } = await import("./db.js");

        await freshInitDb();

        expect(connectMock).toHaveBeenCalledWith("mongodb://test-uri", {
            dbName: "testdb",
        });
        expect(seedInitialBlocks).toHaveBeenCalled();
    });

    it("builds default URI when MONGO_URI is not set", async () => {
        delete process.env.MONGO_URI;
        process.env.MONGO_USER = "user";
        process.env.MONGO_PASSWORD = "pass";
        process.env.MONGO_DB = "pulsar";

        const connectMock = vi
            .mocked(mongoose.connect)
            .mockResolvedValue({} as any);

        const { initDb: freshInitDb } = await import("./db.js");

        await freshInitDb();

        expect(connectMock).toHaveBeenCalledWith(
            "mongodb://user:pass@mongo:27017/pulsar?authSource=admin",
            { dbName: "pulsar" },
        );
    });
});

