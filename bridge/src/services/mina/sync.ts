import logger from "../../common/logger.js";
import { sleep } from "../../common/sleep.js";
import { POLL_INTERVAL_MS } from "../../config/constants.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import { getBridgeState, BridgeStateModel } from "../../db/models/BridgeState.js";
import {
    type MinaClientContext,
    initMinaClientContext,
    getLatestMinaHeight,
    fetchActionsByHeight,
} from "./client.js";

export async function startMinaSync(): Promise<void> {
    const ctx = await initMinaClientContext();

    const state = await getBridgeState();
    let currentHeight = state.lastSyncedHeight;

    logger.info("Starting Mina action sync loop", {
        startHeight: currentHeight,
        network: ctx.network,
        event: "mina_sync_start",
    });

    while (true) {
        try {
            const latestHeight = await getLatestMinaHeight(ctx);

            if (latestHeight > currentHeight) {
                await syncRange(ctx, currentHeight + 1, latestHeight);
                currentHeight = latestHeight;
            }
        } catch (error) {
            logger.error("Error during Mina sync loop", {
                error,
                currentHeight,
                event: "mina_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

async function syncRange(
    ctx: MinaClientContext,
    fromHeight: number,
    toHeight: number,
): Promise<void> {
    const entries = await fetchActionsByHeight(fromHeight, toHeight, ctx);

    for (const entry of entries) {
        await MinaActionModel.findOneAndUpdate(
            { blockHeight: entry.blockHeight },
            {
                $setOnInsert: {
                    blockHeight: entry.blockHeight,
                    actions: entry.actions,
                    status: "pending",
                    failCount: 0,
                },
            },
            { upsert: true, new: true },
        );
    }

    await BridgeStateModel.updateOne(
        {},
        { $set: { lastSyncedHeight: toHeight } },
    );

    logger.info("Mina actions synced", {
        fromHeight,
        toHeight,
        newBlocks: entries.length,
        event: "mina_actions_synced",
    });
}
