import { PublicKey } from "o1js";
import {
    activeNodeEndpoint,
    fetchBlockHeight,
    fetchCheckedAccount,
    setMinaNetwork,
    SettlementContract,
} from "pulsar-contracts";
import logger from "../../common/logger.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    watchedAddress: PublicKey;
    settlementContract: SettlementContract;
    network: MinaNetwork;
    /**
     * The daemon we are actually talking to, re-read on access: a node
     * failover moves it, and a copy taken at startup would keep pointing at
     * the endpoint that failed.
     */
    readonly endpoint: string;
}

export async function initMinaClientContext(
    watchedAddress: PublicKey,
    network: MinaNetwork,
): Promise<MinaClientContext> {
    setMinaNetwork(network);

    await fetchCheckedAccount(watchedAddress, "Contract account fetch");

    const settlementContract = new SettlementContract(watchedAddress);

    logger.info("Initialized Mina client context", {
        network,
        watchedAddress: watchedAddress.toBase58(),
        endpoint: activeNodeEndpoint(network),
        event: "mina_client_initialized",
    });

    return {
        watchedAddress,
        settlementContract,
        network,
        get endpoint() {
            return activeNodeEndpoint(network);
        },
    };
}

export async function getCurrentMinaBlockHeight(
    network: MinaNetwork,
): Promise<number> {
    return fetchBlockHeight(network);
}

export async function getContractBlockHeight(
    ctx: MinaClientContext,
): Promise<number> {
    await fetchCheckedAccount(ctx.watchedAddress, "Contract account fetch");
    return Number(ctx.settlementContract.blockHeight.get().toString());
}
