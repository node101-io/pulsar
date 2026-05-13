import * as grpc from "@grpc/grpc-js";
import logger from "../../common/logger.js";
import { createClient, getLatestPulsarHeight } from "./client.js";
import {
    PULSAR_BRIDGE_SERVICE_NAME,
    TENDERMINT_SERVICE_NAME,
} from "../../config/constants.js";

export interface BridgeTxPayload {
    minaBlockHeight: number;
    proof: unknown; // TBD — shape will be defined once proof type is decided
}

let bridgeClient: any = null;
let tmClient: any = null;

async function getClients() {
    if (bridgeClient && tmClient) return { bridgeClient, tmClient };

    const rpcAddress = process.env.PULSAR_GRPC_ENDPOINT ?? "localhost:50051";
    const credentials = grpc.credentials.createInsecure();

    bridgeClient = await createClient(
        PULSAR_BRIDGE_SERVICE_NAME,
        rpcAddress,
        credentials,
    );
    tmClient = await createClient(
        TENDERMINT_SERVICE_NAME,
        rpcAddress,
        credentials,
    );

    return { bridgeClient, tmClient };
}

export async function getCurrentMinaHeight(): Promise<number> {
    // TODO: confirm the correct gRPC method once bridge module api is finalized
    const { tmClient: tm } = await getClients();
    return getLatestPulsarHeight(tm);
}

export async function sendBridgeTx(payload: BridgeTxPayload): Promise<void> {
    const { bridgeClient: client } = await getClients();

    logger.info("Sending Bridge TX to Pulsar", {
        minaBlockHeight: payload.minaBlockHeight,
        event: "bridge_tx_sending",
    });

    // TODO: replace with actual gRPC method once bridge module message is finalized
    await new Promise<void>((resolve, reject) => {
        client.SubmitBridgeTx(
            {
                mina_block_height: payload.minaBlockHeight.toString(),
                proof: payload.proof,
            },
            (err: unknown) => {
                if (err) return reject(err as Error);
                resolve();
            },
        );
    });

    logger.info("Bridge TX submitted to Pulsar", {
        minaBlockHeight: payload.minaBlockHeight,
        event: "bridge_tx_submitted",
    });
}
