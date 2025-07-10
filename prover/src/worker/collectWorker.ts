import { createWorker } from "./worker.js";
import { CollectSignatureJob, reduceQ } from "../workerConnection.js";
import logger from "../logger.js";

createWorker<CollectSignatureJob, void>({
    queueName: "collect-signature",
    jobHandler: async ({ data }) => {
        const { blockHeight, actions } = data;

        if (actions.length === 0) {
            logger.warn(`No actions found for block height: ${blockHeight}`);
            return;
        }

        logger.info(`Requesting signatures for block height: ${blockHeight}`);
        // Todo: Implement the logic to collect signatures

        reduceQ.add(
            "reduce-" + blockHeight,
            {
                includedActions: new Map(),
                signaturePubkeyArray: [],
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
        logger.info(`Added reduce job for block height: ${blockHeight}`);
    },
});
