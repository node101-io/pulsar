import { PublicKey } from "o1js";
import { MinaClient } from "./minaClient.js";
import dotenv from "dotenv";
import logger from "./logger.js";
import { PulsarClient, VoteExt } from "./pulsarClient.js";
import { reduceQ, settlementQ } from "./workerConnection.js";
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

    minaClient.on("actions", async ({ blockHeight, actions }) => {
        logger.info(`Actions fetched for block ${blockHeight}: ${JSON.stringify(actions)}`);
        await reduceQ.add(
            "reduce-" + blockHeight,
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
        process.env.PULSAR_RPC_ADDRESS || "localhost:50051",
        10000
    );

    pulsarClient.on("start", () => {
        logger.info("Pulsar client started, listening for new blocks");
    });

    pulsarClient.on(
        "newPulsarBlock",
        async ({ blockHeight, voteExts }: { blockHeight: number; voteExts: VoteExt[] }) => {
            logger.info(
                `New Pulsar block detected: ${blockHeight}, with ${voteExts.length} vote extensions`
            );
            await settlementQ.add(
                "settlement-" + blockHeight,
                {
                    blockHeight,
                    voteExts,
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
        }
    );

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
    .then(() => logger.info("Mina client is running"))
    .catch((error) => logger.error(`Error starting Mina client: ${error.message}`));
