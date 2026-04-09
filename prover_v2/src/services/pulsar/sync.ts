import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

import logger from "../../common/logger.js";
import { fetchLastStoredBlock } from "../../db/index.js";
import { BlockData, VoteExt } from "../../common/types.js";
import {
    POLL_INTERVAL_MS,
    TENDERMINT_SERVICE_NAME,
    MINA_KEYS_SERVICE_NAME,
} from "../../config/constants.js";
import {
    createClient,
    getLatestHeight,
    getBlockData,
    storePulsarBlock,
} from "./client.js";
import { decodeMinaSignature } from "./parser.js";
import { sleep } from "../../common/sleep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Real sync
// ---------------------------------------------------------------------------

type TmClient = any;
type MkClient = any;

async function startRealPulsarSync(): Promise<void> {
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

    return { height, stateRoot, validators, voteExt };
}

async function startMockPulsarSync(): Promise<void> {
    if (!process.env.MINA_NETWORK) {
        process.env.MINA_NETWORK = "lightnet";
    }

    const mockGrpcEndpoint =
        process.env.MOCK_GRPC_ENDPOINT || "localhost:50052";

    const lastStored = await fetchLastStoredBlock();
    let currentHeight = lastStored?.height ?? 0;

    logger.info("Starting mock Pulsar sync loop", {
        mockGrpcEndpoint,
        startHeight: currentHeight,
        event: "mock_pulsar_sync_start",
    });

    const client = loadMockClient(mockGrpcEndpoint);

    while (true) {
        try {
            const latestHeight = await getMockLatestHeight(client);

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
