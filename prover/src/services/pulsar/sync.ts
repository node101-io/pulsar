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
    VOTE_EXT_PERSISTENCE_LAG,
} from "../../config/constants.js";
import {
    getLatestHeight,
    grpcCredentials,
    isServiceError,
    AbciQueryClient,
    KeyregistryClient,
    TendermintClient,
    VotePersistenceClient,
} from "pulsar-chain-client";
import {
    getBlockData,
    getVoteExtsByHeight,
    storePulsarBlock,
} from "./client.js";
import { sleep } from "../../common/sleep.js";

async function backfillMissingVoteExtensions(
    vpClient: VotePersistenceClient,
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
    const credentials = grpcCredentials(rpcAddress);

    const tmClient = new TendermintClient(rpcAddress, credentials);
    const vpClient = new VotePersistenceClient(rpcAddress, credentials);
    const krClient = new KeyregistryClient(rpcAddress, credentials);
    const abciClient = new AbciQueryClient(rpcAddress, credentials);

    await backfillMissingVoteExtensions(vpClient, currentHeight);

    logger.info("Starting Pulsar sync loop", {
        rpcAddress,
        startHeight: currentHeight,
        event: "pulsar_sync_start",
    });

    while (true) {
        try {
            const latestHeight = await getLatestHeight(tmClient);
            // VoteExtensions for H are only queryable once H + lag exists.
            const processUpTo = latestHeight - VOTE_EXT_PERSISTENCE_LAG;

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
