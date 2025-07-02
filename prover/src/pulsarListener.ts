import logger from "./logger.js";
import dotenv from "dotenv";
import { Block, SignaturePublicKeyList } from "pulsar-contracts";
dotenv.config();

export interface BlockHeader {
    height: number;
    hash: string;
    time: string;
}
const RPC_ENDPOINT = process.env.COSMOS_RPC_WS ?? "ws://localhost:26657/websocket";
const RECONNECT_DELAY_MS = 5_000;

let blockSignatureBuf: Array<[Block, SignaturePublicKeyList]> = [];

async function main(): Promise<void> {}

async function connectWithRetry(url: string): Promise<any> {
    try {
        let client: any;

        return client;
    } catch (e) {
        logger.error("WS connect failed, retrying…", e);
        await delay(RECONNECT_DELAY_MS);
        return connectWithRetry(url);
    }
}

function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => logger.error("listener crashed:", err));
