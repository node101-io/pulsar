import { PublicKey } from "o1js";

import logger from "../../logger.js";
import { fetchLastStoredBlock } from "../db/index.js";
import { POLL_INTERVAL_MS } from "../utils/constants.js";
import { sleep } from "../utils/functions.js";
import {
    type MinaNetwork,
    type MinaClientContext,
    initMinaClientContext,
    getCurrentMinaBlockHeight,
    fetchMinaActions,
} from "./client.js";

export async function startMinaSync() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        throw new Error(
            "CONTRACT_ADDRESS is not set in the environment variables",
        );
    }

    const network: MinaNetwork =
        (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";

    const lastStored = await fetchLastStoredBlock();
    let lastSeenBlockHeight = lastStored?.height ?? 0;

    const watchedAddress = PublicKey.fromBase58(contractAddress);

    const ctx: MinaClientContext = await initMinaClientContext(
        watchedAddress,
        network,
    );

    logger.info("Starting Mina sync loop", {
        network,
        startHeight: lastSeenBlockHeight,
        watchedAddress: watchedAddress.toBase58(),
        event: "mina_sync_start",
    });

    while (true) {
        try {
            const currentHeight = await getCurrentMinaBlockHeight(network);

            if (currentHeight > lastSeenBlockHeight) {
                logger.info("New Mina block detected", {
                    fromHeight: lastSeenBlockHeight + 1,
                    toHeight: currentHeight,
                    event: "mina_new_block",
                });

                const actions = await fetchMinaActions(ctx);

                logger.info("Mina actions fetched", {
                    blockHeight: currentHeight,
                    actionsCount: actions.length,
                    event: "mina_actions_fetched",
                });

                if (actions.length === 0) {
                    logger.info("No actions found for block, skipping", {
                        blockHeight: currentHeight,
                        event: "mina_actions_empty",
                    });
                } else {
                    // * integration with processors/queues can be added here
                }

                lastSeenBlockHeight = currentHeight;
            }
        } catch (error) {
            logger.error("Error during Mina sync loop", error as Error, {
                lastSeenBlockHeight,
                network,
                event: "mina_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}
