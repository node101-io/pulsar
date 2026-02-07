import { List } from "pulsar-contracts";
import { Poseidon, PublicKey } from "o1js";

import logger from "../../logger.js";
import { PulsarClient } from "./client.js";
import { DB, fetchLastStoredBlock } from "../db/index.js";
import { BlockData } from "../utils/interfaces.js";
import { POLL_INTERVAL_MS } from "../utils/constants.js";

export async function startPulsarSync() {
    const db = new DB();
    await db.initMongo();

    const lastStored = await fetchLastStoredBlock();
    const initialHeight = lastStored?.height ?? 0;

    const rpcAddress = process.env.PULSAR_GRPC_ENDPOINT || "localhost:50051";

    const client = new PulsarClient(
        rpcAddress,
        initialHeight,
        POLL_INTERVAL_MS,
    );

    client.on("start", () => {
        logger.info("Pulsar client started, listening for new blocks");
    });

    client.on(
        "newPulsarBlock",
        async ({ blockData }: { blockData: BlockData }) => {
            try {
                if (blockData.height <= initialHeight) {
                    return;
                }

                await storeBlock(db, blockData);
            } catch (error) {
                logger.error(
                    "Error while handling new Pulsar block",
                    error as Error,
                    {
                        blockHeight: blockData.height,
                        event: "pulsar_block_handle_error",
                    },
                );
            }
        },
    );

    client.on("error", (error: Error) => {
        logger.error("Error in Pulsar client", error, {
            event: "pulsar_client_error",
        });
    });

    client.on("stop", () => {
        logger.info("Pulsar client stopped", {
            event: "pulsar_client_stopped",
        });
    });

    await client.start();
}

function computeValidatorListHash(validators: string[]): string {
    const validatorsList = List.empty();

    for (const validator of validators) {
        validatorsList.push(
            Poseidon.hash(PublicKey.fromBase58(validator).toFields()),
        );
    }

    return validatorsList.hash.toString();
}

async function storeBlock(db: DB, blockData: BlockData) {
    const { validators, ...rest } = blockData;

    const validatorListHash = computeValidatorListHash(validators);

    await db.storeBlock({
        ...rest,
        validators,
        validatorListHash,
    });

    logger.info("Stored Pulsar block", {
        blockHeight: blockData.height,
        validatorsCount: validators.length,
        event: "pulsar_block_stored",
    });
}
