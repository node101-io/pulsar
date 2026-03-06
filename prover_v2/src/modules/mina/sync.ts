import { PublicKey } from "o1js";

import logger from "../../logger.js";
import { saveMinaState } from "../db/index.js";
import { POLL_INTERVAL_MS } from "../utils/constants.js";
import { sleep } from "../utils/functions.js";
import {
    type MinaNetwork,
    type MinaClientContext,
    initMinaClientContext,
    getCurrentMinaBlockHeight,
    getContractBlockHeight,
} from "./client.js";

export async function startMinaSync(): Promise<void> {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        throw new Error("CONTRACT_ADDRESS is not set in the environment variables");
    }

    const network: MinaNetwork =
        (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";

    const watchedAddress = PublicKey.fromBase58(contractAddress);
    const ctx = await initMinaClientContext(watchedAddress, network);

    // Initial sync: fetch last settled Pulsar block from Mina, persist to DB.
    // This ensures correct startup even after downtime (others may have settled).
    await syncContractState(ctx);

    logger.info("Starting Mina sync loop", {
        network,
        watchedAddress: watchedAddress.toBase58(),
        event: "mina_sync_start",
    });

    let lastSeenMinaHeight = await getCurrentMinaBlockHeight(network);

    while (true) {
        try {
            const currentHeight = await getCurrentMinaBlockHeight(network);

            if (currentHeight > lastSeenMinaHeight) {
                logger.info("New Mina block detected", {
                    fromHeight: lastSeenMinaHeight + 1,
                    toHeight: currentHeight,
                    event: "mina_new_block",
                });

                await syncContractState(ctx);
                lastSeenMinaHeight = currentHeight;
            }
        } catch (error) {
            logger.error("Error during Mina sync loop", error as Error, {
                lastSeenMinaHeight,
                network,
                event: "mina_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

async function syncContractState(ctx: MinaClientContext): Promise<void> {
    const lastSettledPulsarBlock = await getContractBlockHeight(ctx);
    await saveMinaState(lastSettledPulsarBlock);

    logger.info("Mina contract state synced", {
        lastSettledPulsarBlock,
        event: "mina_state_synced",
    });
}
