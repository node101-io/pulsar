import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { readFile, writeFile, rename } from "fs/promises";

import logger from "../../common/logger.js";
import {
    fetchLastStoredBlock,
    BlockModel,
    BlockEpochModel,
} from "../../db/index.js";
import { BlockData, VoteExt } from "../../common/types.js";
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
    storePulsarBlock,
} from "./client.js";
import { decodeMinaSignature } from "./parser.js";
import { sleep } from "../../common/sleep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Real sync
// ---------------------------------------------------------------------------

async function backfillMissingVoteExtensions(
    vpClient: any,
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
                    error: (err as any)?.message,
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

async function startRealPulsarSync(): Promise<void> {
    const lastStored = await fetchLastStoredBlock();
    // currentHeight = 0 means nothing stored yet; loop will start at h = 1.
    // We only process block H when latestHeight >= H + 2 so that
    // x-cosmos-block-height: H+2 is guaranteed to return vote extensions for H.
    let currentHeight = lastStored?.height ?? 0;

    const rpcAddress = process.env.PULSAR_GRPC_ENDPOINT || "localhost:9090";
    const credentials = grpc.credentials.createInsecure();

    const tmClient = await createClient(
        TENDERMINT_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const vpClient = await createClient(
        VOTE_PERSISTENCE_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const krClient = await createClient(
        MINA_KEYS_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    const abciClient = await createClient(
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
            const err = error as any;
            logger.error("Error during Pulsar sync loop", {
                message: err?.message ?? String(error),
                code: err?.code,
                details: err?.details,
                stack: err?.stack,
                currentHeight,
                event: "pulsar_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

// ---------------------------------------------------------------------------
// Mock sync state
// ---------------------------------------------------------------------------

interface MockSyncState {
    height: number;
    validators: string[];
}

function getMockSyncStatePath(): string {
    return process.env.MOCK_SYNC_STATE_PATH || "./mock-sync-state.json";
}

async function readMockSyncState(): Promise<MockSyncState | null> {
    try {
        const raw = await readFile(getMockSyncStatePath(), "utf8");
        return JSON.parse(raw) as MockSyncState;
    } catch {
        return null;
    }
}

async function writeMockSyncState(state: MockSyncState): Promise<void> {
    const target = getMockSyncStatePath();
    const tmp = target + ".tmp";
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, target); // atomic on same filesystem, no corruption
}

// ---------------------------------------------------------------------------
// Mock (TEST_MODE) helpers
// ---------------------------------------------------------------------------

const MOCK_PROTO_PATH = join(
    __dirname,
    "..",
    "..",
    "mock",
    "proto",
    "voteexthandler.proto",
);

function loadMockClient(address: string): any {
    const packageDef = protoLoader.loadSync(MOCK_PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const ServiceClass = proto.pulsarchain.voteexthandler.v1.Query;
    return new ServiceClass(address, grpc.credentials.createInsecure());
}

function grpcCall<T>(client: any, method: string, req: any): Promise<T> {
    return new Promise((resolve, reject) => {
        client[method](req, (err: unknown, res: T) => {
            if (err) return reject(err as Error);
            resolve(res);
        });
    });
}

async function getMockLatestHeight(client: any): Promise<number> {
    const res = await grpcCall<any>(client, "GetLatestHeight", {});
    return Number(res.height);
}

async function getMockBlockData(
    client: any,
    height: number,
): Promise<BlockData> {
    const [voteExtsRes, stateRes] = await Promise.all([
        grpcCall<any>(client, "GetAllVoteExtsByHeight", { height }),
        grpcCall<any>(client, "GetStateAtHeight", { height }),
    ]);

    const stateRootBuf: Buffer = stateRes.state_root;
    const stateRoot = BigInt("0x" + stateRootBuf.toString("hex")).toString();
    const validators: string[] = stateRes.validators as string[];

    const voteExt: VoteExt[] = (voteExtsRes.vote_exts as any[]).map((ve) => ({
        index: ve.index,
        height: Number(ve.height),
        validatorAddr: ve.validator_addr,
        signature: decodeMinaSignature(
            (ve.signature as Buffer).toString("hex"),
        ),
    }));

    return { height, stateRoot, validators, actionsReducedRoot: "0", voteExt };
}

async function startMockPulsarSync(): Promise<void> {
    if (!process.env.MINA_NETWORK) {
        process.env.MINA_NETWORK = "lightnet";
    }

    const mockGrpcEndpoint =
        process.env.MOCK_GRPC_ENDPOINT || "localhost:50052";

    const savedState = await readMockSyncState();
    let currentHeight = savedState?.height ?? -1;
    let currentValidators: string[] = savedState?.validators ?? [];

    logger.info("Starting mock Pulsar sync loop", {
        mockGrpcEndpoint,
        startHeight: currentHeight,
        event: "mock_pulsar_sync_start",
    });

    const client = loadMockClient(mockGrpcEndpoint);

    while (true) {
        try {
            const latestHeight = await getMockLatestHeight(client);

            if (latestHeight < currentHeight) {
                logger.warn(
                    "Mock server restarted — resuming from mock's latest block",
                    {
                        mockLatest: latestHeight,
                        previousHeight: currentHeight,
                        event: "mock_restart_detected",
                    },
                );
                currentHeight = -1;
                currentValidators = [];
                await writeMockSyncState({ height: -1, validators: [] });
            }

            if (latestHeight > currentHeight) {
                logger.info("New mock blocks detected", {
                    fromHeight: currentHeight + 1,
                    toHeight: latestHeight,
                    count: latestHeight - currentHeight,
                    event: "mock_new_blocks",
                });

                for (let h = currentHeight + 1; h <= latestHeight; h++) {
                    const blockData = await getMockBlockData(client, h);
                    await storePulsarBlock(blockData);
                    currentHeight = h;
                    currentValidators = blockData.validators;
                    await writeMockSyncState({
                        height: currentHeight,
                        validators: currentValidators,
                    });
                }
            }
        } catch (error) {
            logger.error("Error during mock Pulsar sync loop", {
                error,
                currentHeight,
                event: "mock_pulsar_sync_error",
            });
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startPulsarSync(): Promise<void> {
    if (process.env.TEST_MODE === "true") {
        return startMockPulsarSync();
    }
    return startRealPulsarSync();
}
