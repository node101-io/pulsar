import { PublicKey } from "o1js";
import { MinaClient } from "./minaClient.js";
import dotenv from "dotenv";
import logger from "./logger.js";
dotenv.config();

async function main() {
    if (!process.env.CONTRACT_ADDRESS) {
        throw new Error("CONTRACT_ADDRESS is not set in the environment variables");
    }

    const minaClient = new MinaClient(
        PublicKey.fromBase58(process.env.CONTRACT_ADDRESS),
        "lightnet",
        5000
    );

    minaClient.on("start", (blockHeight) => {
        logger.info(`Mina client started, watching actions from block height: ${blockHeight}`);
    });

    minaClient.on("block", (blockHeight) => {
        logger.info(`New block detected: ${blockHeight}`);
    });

    minaClient.on("actions", ({ blockHeight, actions }) => {
        logger.info(`Actions fetched for block ${blockHeight}: ${JSON.stringify(actions)}`);
    });

    minaClient.on("error", (error) => {
        logger.error(`Error in Mina client: ${error.message}`);
    });

    minaClient.on("stop", () => {
        logger.info("Mina client stopped");
    });

    await minaClient.start();
}

main()
    .then(() => logger.info("Mina client is running"))
    .catch((error) => logger.error(`Error starting Mina client: ${error.message}`));
