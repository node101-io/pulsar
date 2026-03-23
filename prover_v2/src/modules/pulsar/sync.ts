import * as grpc from "@grpc/grpc-js";

import logger from "../../logger.js";
import { fetchLastStoredBlock } from "../db/index.js";
import { BlockData } from "../utils/interfaces.js";
import {
    POLL_INTERVAL_MS,
    TENDERMINT_SERVICE_NAME,
    MINA_KEYS_SERVICE_NAME,
} from "../utils/constants.js";
import {
    createClient,
    getLatestHeight,
    getBlockData,
    storePulsarBlock,
} from "./utils.js";
import { sleep } from "../utils/functions.js";

type TmClient = any;
type MkClient = any;

export async function startPulsarSync() {
    const lastStored = await fetchLastStoredBlock();
    let currentHeight = lastStored?.height ?? 0;

    const rpcAddress = process.env.PULSAR_GRPC_ENDPOINT || "localhost:50051";

    logger.info("Starting Pulsar sync loop", {
        rpcAddress,
        startHeight: currentHeight,
        event: "pulsar_sync_start",
    });

    const credentials = grpc.credentials.createInsecure();

    const tmClient = (await createClient(
        TENDERMINT_SERVICE_NAME,
        rpcAddress,
        credentials,
    )) as TmClient;
    const mkClient = (await createClient(
        MINA_KEYS_SERVICE_NAME,
        rpcAddress,
        credentials,
    )) as MkClient;

    while (true) {
        try {
            const latestHeight = await getLatestHeight(tmClient);

            if (latestHeight > currentHeight) {
                logger.info("New Pulsar blocks detected", {
                    fromHeight: currentHeight + 1,
                    toHeight: latestHeight,
                    count: latestHeight - currentHeight,
                    event: "pulsar_new_blocks",
                });

                for (let h = currentHeight + 1; h <= latestHeight; h++) {
                    const blockData: BlockData = await getBlockData(
                        tmClient,
                        mkClient,
                        h,
                    );
                    await storePulsarBlock(blockData);
                    currentHeight = h;
                }
            }
        } catch (error) {
            logger.error("Error during Pulsar sync loop", {
                error,
                currentHeight,
                event: "pulsar_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}
