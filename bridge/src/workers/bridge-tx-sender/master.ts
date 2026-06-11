import { Queue } from "bullmq";
import { Master } from "../master.js";
import { connection } from "../redis.js";
import { bridgeTxSenderQ } from "../queue.js";
import { worker as processBridgeTx } from "./worker.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import {
    getBridgeState,
    BridgeStateModel,
} from "../../db/models/BridgeState.js";
import {
    type MinaClientContext,
    initMinaClientContext,
    getLatestMinaHeight,
} from "../../services/mina/client.js";
import {
    MASTER_SLEEP_INTERVAL_MS,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    HARD_FINALITY_BLOCKS,
    MAX_FAIL_COUNT,
} from "../../config/constants.js";

export interface BridgeTxJob {
    blockHeight: number;
    actions: object[];
}

export class BridgeTxSenderMaster extends Master<BridgeTxJob> {
    private ctx!: MinaClientContext;
    private halted = false;

    constructor() {
        super({
            queueName: "bridge-tx-sender",
            workerLabel: "BridgeTxSender",
            connection,
            workerCount: 1, // sıralı çalışmalı, her reduce bir sonraki için actionState'i güncelliyor
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processBridgeTx(job.data);
            },
            onJobFailed: async (job) => {
                if (job?.data.blockHeight !== undefined) {
                    const updated = await MinaActionModel.findOneAndUpdate(
                        {
                            blockHeight: job.data.blockHeight,
                            status: "submitted",
                        },
                        { $inc: { failCount: 1 } },
                        { new: true },
                    );
                    if (!updated) return;

                    if (updated.failCount >= MAX_FAIL_COUNT) {
                        await MinaActionModel.updateOne(
                            { blockHeight: job.data.blockHeight },
                            { $set: { status: "failed" } },
                        );
                        logger.error("Bridge TX permanently failed", {
                            blockHeight: job.data.blockHeight,
                            failCount: updated.failCount,
                            event: "bridge_tx_failed",
                        });
                    } else {
                        await MinaActionModel.updateOne(
                            { blockHeight: job.data.blockHeight },
                            { $set: { status: "pending" } },
                        );
                    }
                }
            },
        });
    }

    async onStartup(): Promise<void> {
        this.ctx = await initMinaClientContext();

        const stuckBlocks = await MinaActionModel.find({ status: "submitted" });
        for (const block of stuckBlocks) {
            await MinaActionModel.updateOne(
                { blockHeight: block.blockHeight },
                { $set: { status: "pending" } },
            );
            logger.warn("Reset stuck submitted block to pending on startup", {
                blockHeight: block.blockHeight,
                event: "stuck_block_reset",
            });
        }

        const queue = new Queue("bridge-tx-sender", { connection });
        await queue.obliterate({ force: true });
        await queue.close();
    }

    async handleTask(): Promise<void> {
        if (this.halted) {
            await sleep(MASTER_SLEEP_INTERVAL_MS * 60);
            return;
        }

        const counts = await bridgeTxSenderQ.getJobCounts(
            "waiting",
            "active",
            "delayed",
        );
        if (counts.waiting + counts.active + counts.delayed > 0) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        let currentMinaHeight: number;
        try {
            currentMinaHeight = await getLatestMinaHeight(this.ctx);
        } catch (error) {
            logger.error("Failed to get current Mina height", {
                error,
                event: "mina_height_fetch_error",
            });
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        const state = await getBridgeState();
        const nextHeight = state.lastSubmittedHeight + 1;

        const block = await MinaActionModel.findOne({
            blockHeight: nextHeight,
            status: "pending",
            $expr: {
                $lte: [
                    "$blockHeight",
                    currentMinaHeight - HARD_FINALITY_BLOCKS,
                ],
            },
        });

        if (!block) {
            const failedBlock = await MinaActionModel.findOne({
                blockHeight: nextHeight,
                status: "failed",
            });

            if (failedBlock) {
                this.halted = true;
                logger.error("Next height is permanently failed — halting master. Manual intervention required.", {
                    blockHeight: nextHeight,
                    failCount: failedBlock.failCount,
                    event: "master_halted_failed_block",
                });
                return;
            }

            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        await MinaActionModel.updateOne(
            { blockHeight: block.blockHeight },
            { $set: { status: "submitted" } },
        );

        await bridgeTxSenderQ.add("bridge-tx-sender", {
            blockHeight: block.blockHeight,
            actions: block.actions,
        });

        logger.info("Queued bridge TX job", {
            blockHeight: block.blockHeight,
            event: "bridge_tx_queued",
        });
    }
}

export async function masterRunner() {
    const master = new BridgeTxSenderMaster();
    await master.run();
}
