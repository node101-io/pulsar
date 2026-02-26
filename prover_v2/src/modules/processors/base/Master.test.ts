import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bullmq", () => {
    class WorkerMock {
        static instances: any[] = [];
        handlers: Record<string, any> = {};
        constructor(
            public queueName: string,
            public processor: any,
            public opts: any,
        ) {
            WorkerMock.instances.push(this);
        }
        on(event: string, handler: any) {
            this.handlers[event] = handler;
            return this;
        }
    }
    return { Worker: WorkerMock };
});

vi.mock("../../../logger.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import { Worker } from "bullmq";
import { Master } from "./Master.js";

class TestMaster extends Master<{ a: number }> {
    public async init() {
        return await (this as any).initializeWorkers();
    }
    public async makeWorker(id: number) {
        return await (this as any).createWorker(id);
    }
    protected async handleTask(): Promise<void> {}
}

describe("processors base Master", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Worker as any).instances = [];
    });

    it("initializeWorkers creates workerCount workers", async () => {
        const m = new TestMaster({
            queueName: "q",
            workerLabel: "L",
            connection: {} as any,
            workerCount: 3,
            lockDurationMs: 111,
            stalledIntervalMs: 222,
            processJob: vi.fn(async () => {}),
        });

        await m.init();

        expect((Worker as any).instances.length).toBe(3);
        expect((Worker as any).instances[0].opts.lockDuration).toBe(111);
        expect((Worker as any).instances[0].opts.stalledInterval).toBe(222);
    });

    it("worker processor calls processJob", async () => {
        const processJob = vi.fn(async () => {});
        const m = new TestMaster({
            queueName: "q",
            workerLabel: "L",
            connection: {} as any,
            workerCount: 1,
            lockDurationMs: 1,
            stalledIntervalMs: 1,
            processJob,
        });

        const w: any = await m.makeWorker(0);
        await w.processor({ id: "1", data: { a: 1 } });

        expect(processJob).toHaveBeenCalledWith(0, { id: "1", data: { a: 1 } });
    });

    it("failed handler calls onJobFailed when provided", async () => {
        const onJobFailed = vi.fn(async () => {});
        const m = new TestMaster({
            queueName: "q",
            workerLabel: "L",
            connection: {} as any,
            workerCount: 1,
            lockDurationMs: 1,
            stalledIntervalMs: 1,
            processJob: vi.fn(async () => {}),
            onJobFailed,
        });

        const w: any = await m.makeWorker(7);
        await w.handlers.failed({ id: "x", data: { a: 2 } }, new Error("e"));

        expect(onJobFailed).toHaveBeenCalled();
    });
});

