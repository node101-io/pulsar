import { PublicKey } from "o1js";
import { MinaClient } from "./minaClient.js";
import dotenv from "dotenv";
import logger from "./logger.js";
import { PulsarClient } from "./pulsarClient.js";
import { collectSignatureQ, settlementQ } from "./workerConnection.js";
import { fetchLastStoredBlock, initMongo } from "./db.js";
import { BlockData } from "./interfaces.js";
dotenv.config();

async function main() {
    if (!process.env.CONTRACT_ADDRESS) {
        throw new Error("CONTRACT_ADDRESS is not set in the environment variables");
    }

    await initMongo();
    const lastSeenBlockHeight = (await fetchLastStoredBlock())?.height || 0;

    let minaClient = new MinaClient(
        PublicKey.fromBase58(process.env.CONTRACT_ADDRESS),
        process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet",
        lastSeenBlockHeight,
        5000
    );

    minaClient.on("start", (blockHeight) => {
        logger.info(`Mina client started, watching actions from block height: ${blockHeight}`);
    });

    minaClient.on("actions", async ({ blockHeight, actions }) => {
        logger.info(`Actions fetched for block ${blockHeight}: ${JSON.stringify(actions)}`);
        if (actions.length === 0) {
            logger.info(`No actions found for block ${blockHeight}, skipping...`);
            return;
        }
        await collectSignatureQ.add(
            "collect-" + blockHeight,
            {
                blockHeight,
                actions,
            },
            {
                attempts: 5,
                backoff: {
                    type: "exponential",
                    delay: 5_000,
                },
                removeOnComplete: true,
            }
        );
    });

    minaClient.on("error", (error) => {
        logger.error(`Error in Mina client: ${error.message}`);

        minaClient.stop();
        logger.info("Mina client stopped due to error, restarting in 5 seconds...");
        setTimeout(() => {
            minaClient.start();
        }, 5000);
    });

    minaClient.on("stop", () => {
        logger.info("Mina client stopped");
    });

    const pulsarClient = new PulsarClient(
        process.env.PULSAR_GRPC_ENDPOINT || "localhost:50051",
        0,
        10000
    );

    pulsarClient.on("start", () => {
        logger.info("Pulsar client started, listening for new blocks");
    });

    pulsarClient.on("newPulsarBlock", async ({ blockData }: { blockData: BlockData }) => {
        // logger.info("New Pulsar block detected: ", blockData.height);
        await settlementQ.add(
            "settlement-" + blockData.height,
            {
                blockData,
            },
            {
                attempts: 5,
                backoff: {
                    type: "exponential",
                    delay: 5_000,
                },
                removeOnComplete: true,
            }
        );
    });

    pulsarClient.on("error", (error) => {
        logger.error(`Error in Pulsar client: ${error.message}`);
    });

    pulsarClient.on("stop", () => {
        logger.info("Pulsar client stopped");
    });

    await minaClient.start();
    await pulsarClient.start();
}

main()
    .then(() => logger.info("Client is running"))
    .catch((error) => logger.error(`Error starting client: ${error.message}`));
