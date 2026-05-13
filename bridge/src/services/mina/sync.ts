import logger from "../../common/logger.js";
import { sleep } from "../../common/sleep.js";
import { POLL_INTERVAL_MS } from "../../config/constants.js";
import { getLatestMinaHeight, fetchActionsByHeight } from "./client.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import { getBridgeState, BridgeStateModel } from "../../db/models/BridgeState.js";

export async function startMinaSync(): Promise<void> {
    const state = await getBridgeState();
    let currentHeight = state.lastSyncedHeight;

    logger.info("Starting Mina action sync loop", {
        startHeight: currentHeight,
        event: "mina_sync_start",
    });

    while (true) {
        try {
            const latestHeight = await getLatestMinaHeight();

            if (latestHeight > currentHeight) {
                const entries = await fetchActionsByHeight(currentHeight + 1, latestHeight);

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
                    { $set: { lastSyncedHeight: latestHeight } },
                );

                currentHeight = latestHeight;

                logger.info("Mina actions synced", {
                    fromHeight: currentHeight + 1,
                    toHeight: latestHeight,
                    newBlocks: entries.length,
                    event: "mina_actions_synced",
                });
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
