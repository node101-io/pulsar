import { fetchAccount, PublicKey } from "o1js";
import {
    fetchBlockHeight,
    setMinaNetwork,
    SettlementContract,
    ENDPOINTS,
} from "pulsar-contracts";
import logger from "../../common/logger.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    watchedAddress: PublicKey;
    settlementContract: SettlementContract;
    network: MinaNetwork;
    endpoint: string;
}

export async function initMinaClientContext(
    watchedAddress: PublicKey,
    network: MinaNetwork,
): Promise<MinaClientContext> {
    setMinaNetwork(network);

    await fetchAccount({ publicKey: watchedAddress });

    const settlementContract = new SettlementContract(watchedAddress);
    const endpoint = ENDPOINTS.NODE[network];

    logger.info("Initialized Mina client context", {
        network,
        watchedAddress: watchedAddress.toBase58(),
        event: "mina_client_initialized",
    });

    return { watchedAddress, settlementContract, network, endpoint };
}

export async function getCurrentMinaBlockHeight(
    network: MinaNetwork,
): Promise<number> {
    return fetchBlockHeight(network);
}

export async function getContractBlockHeight(
    ctx: MinaClientContext,
): Promise<number> {
    await fetchAccount({ publicKey: ctx.watchedAddress });
    return Number(ctx.settlementContract.blockHeight.get().toString());
}
