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
    grpcUnary,
    isServiceError,
    storePulsarBlock,
} from "./client.js";
import {
    AbciQueryService,
    GrpcCallback,
    KeyregistryService,
    TendermintService,
    VotePersistenceService,
} from "./grpcTypes.js";
import { decodeMinaSignature } from "./parser.js";
import { sleep } from "../../common/sleep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Real sync
// ---------------------------------------------------------------------------

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

async function startRealPulsarSync(): Promise<void> {
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

// ---------------------------------------------------------------------------
// Mock sync state
// ---------------------------------------------------------------------------

interface MockSyncState {
    height: number;
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

// Shapes served by the mock gRPC server (src/mock/grpcServer.ts).
interface MockLatestHeightResponse {
    height: string;
}

interface MockVoteExtsResponse {
    vote_exts: { validator_addr: string; signature: Buffer }[];
}

interface MockStateResponse {
    state_root: Buffer;
    validators: string[];
}

interface MockQueryService {
    GetLatestHeight(
        req: Record<string, never>,
        cb: GrpcCallback<MockLatestHeightResponse>,
    ): void;
    GetAllVoteExtsByHeight(
        req: { height: number },
        cb: GrpcCallback<MockVoteExtsResponse>,
    ): void;
    GetStateAtHeight(
        req: { height: number },
        cb: GrpcCallback<MockStateResponse>,
    ): void;
}

function loadMockClient(address: string): MockQueryService {
    const packageDef = protoLoader.loadSync(MOCK_PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    // Dynamically loaded constructor — the traversal is untyped; the returned
    // client is pinned to the mock service surface above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const ServiceClass = proto.pulsarchain.voteexthandler.v1.Query;
    return new ServiceClass(
        address,
        grpc.credentials.createInsecure(),
    ) as MockQueryService;
}

async function getMockLatestHeight(client: MockQueryService): Promise<number> {
    const res = await grpcUnary<MockLatestHeightResponse>((cb) =>
        client.GetLatestHeight({}, cb),
    );
    return Number(res.height);
}

async function getMockBlockData(
    client: MockQueryService,
    height: number,
): Promise<BlockData> {
    const [voteExtsRes, stateRes] = await Promise.all([
        grpcUnary<MockVoteExtsResponse>((cb) =>
            client.GetAllVoteExtsByHeight({ height }, cb),
        ),
        grpcUnary<MockStateResponse>((cb) =>
            client.GetStateAtHeight({ height }, cb),
        ),
    ]);

    const stateRoot = BigInt(
        "0x" + stateRes.state_root.toString("hex"),
    ).toString();
    // The mock chain does not model voting power; weight everyone equally.
    const validators = stateRes.validators.map((addr) => ({
        addr,
        power: "1",
    }));

    const voteExt: VoteExt[] = voteExtsRes.vote_exts.map((ve) => ({
        validatorAddr: ve.validator_addr,
        signature: decodeMinaSignature(ve.signature),
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
                await writeMockSyncState({ height: -1 });
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
                    await writeMockSyncState({ height: currentHeight });
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
