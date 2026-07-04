import * as grpc from "@grpc/grpc-js";

import logger from "../../common/logger.js";
import {
    fetchLastStoredBlock,
    BlockModel,
    BlockEpochModel,
} from "../../db/index.js";
import { BlockData } from "../../common/types.js";
import {
    POLL_INTERVAL_MS,
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
    TENDERMINT_SERVICE_NAME,
    VOTE_PERSISTENCE_SERVICE_NAME,
    MINA_KEYS_SERVICE_NAME,
    ABCI_SERVICE_NAME,
} from "../../config/constants.js";
import {
    createClient,
    getLatestHeight,
    getBlockData,
    getVoteExtsByHeight,
    isServiceError,
    storePulsarBlock,
} from "./client.js";
import {
    AbciQueryService,
    KeyregistryService,
    TendermintService,
    VotePersistenceService,
} from "./grpcTypes.js";
import { sleep } from "../../common/sleep.js";

async function backfillMissingVoteExtensions(
    vpClient: VotePersistenceService,
    maxHeight: number,
): Promise<void> {
    const blocks = await BlockModel.find({
        height: { $gt: 0, $lte: maxHeight },
        voteExt: { $size: 0 },
    }).sort({ height: 1 });

    if (blocks.length === 0) return;

    logger.info(`Backfilling vote extensions for ${blocks.length} blocks`, {
        heights: blocks.map((b) => b.height),
        event: "vote_ext_backfill_start",
    });

    const epochsToReset = new Set<number>();

    for (const block of blocks) {
        try {
            const voteExt = await getVoteExtsByHeight(vpClient, block.height);
            if (voteExt.length === 0) continue;

            await BlockModel.updateOne(
                { height: block.height },
                { $set: { voteExt } },
            );

            const epochHeight =
                EPOCH_START_HEIGHT +
                Math.floor((block.height - EPOCH_START_HEIGHT) / BLOCK_EPOCH_SIZE) *
                    BLOCK_EPOCH_SIZE;
            epochsToReset.add(epochHeight);

            logger.info(
                `Backfilled vote extensions for block ${block.height}`,
                {
                    voteExtCount: voteExt.length,
                    event: "vote_ext_backfilled",
                },
            );
        } catch (err) {
            logger.warn(
                `Could not backfill vote extensions for block ${block.height}`,
                {
                    error: err instanceof Error ? err.message : String(err),
                    event: "vote_ext_backfill_error",
                },
            );
        }
    }

    for (const epochHeight of epochsToReset) {
        await BlockEpochModel.updateOne(
            { height: epochHeight },
            { $set: { epochStatus: "waiting", failCount: 0 } },
        );
        logger.info(
            `Reset block epoch ${epochHeight} to waiting for re-proof`,
            {
                event: "epoch_reset",
            },
        );
    }
}

export async function startPulsarSync(): Promise<void> {
    const lastStored = await fetchLastStoredBlock();
    // currentHeight = 0 means nothing stored yet; loop will start at h = 1.
    // We only process block H when latestHeight >= H + 2 so that
    // x-cosmos-block-height: H+2 is guaranteed to return vote extensions for H.
    let currentHeight = lastStored?.height ?? 0;

    const rpcAddress = process.env.PULSAR_GRPC_ENDPOINT || "localhost:9090";
    const credentials = grpc.credentials.createInsecure();

    const tmClient = await createClient<TendermintService>(
        TENDERMINT_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const vpClient = await createClient<VotePersistenceService>(
        VOTE_PERSISTENCE_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const krClient = await createClient<KeyregistryService>(
        MINA_KEYS_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const abciClient = await createClient<AbciQueryService>(
        ABCI_SERVICE_NAME,
        rpcAddress,
        credentials,
    );

    await backfillMissingVoteExtensions(vpClient, currentHeight);

    logger.info("Starting Pulsar sync loop", {
        rpcAddress,
        startHeight: currentHeight,
        event: "pulsar_sync_start",
    });

    while (true) {
        try {
            const latestHeight = await getLatestHeight(tmClient);
            // VoteExtensions for H requires x-cosmos-block-height: H+3, so H+3 must exist
            const processUpTo = latestHeight - 3;

            if (processUpTo > currentHeight) {
                logger.info("New Pulsar blocks detected", {
                    fromHeight: currentHeight + 1,
                    toHeight: processUpTo,
                    count: processUpTo - currentHeight,
                    event: "pulsar_new_blocks",
                });

                for (let h = currentHeight + 1; h <= processUpTo; h++) {
                    const blockData: BlockData = await getBlockData(
                        tmClient,
                        vpClient,
                        krClient,
                        abciClient,
                        h,
                    );
                    await storePulsarBlock(blockData);
                    currentHeight = h;
                }
            }
        } catch (error) {
            logger.error("Error during Pulsar sync loop", {
                message: error instanceof Error ? error.message : String(error),
                code: isServiceError(error) ? error.code : undefined,
                details: isServiceError(error) ? error.details : undefined,
                stack: error instanceof Error ? error.stack : undefined,
                currentHeight,
                event: "pulsar_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}
