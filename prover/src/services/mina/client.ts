import { fetchAccount, PublicKey } from "o1js";
import {
    activeNodeEndpoint,
    fetchBlockHeight,
    setMinaNetwork,
    SettlementContract,
    withNodeFailover,
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

/**
 * fetchAccount into the o1js cache, failing over to a fallback node when the
 * account cannot be read.
 *
 * The explicit throw is what makes the failover work at all: fetchAccount
 * RESOLVES with `{ error }` instead of rejecting, so a bare call cannot
 * distinguish "this node has no ledger" from "this account does not exist"
 * and withNodeFailover would never see a failure to retry.
 */
async function fetchAccountOrThrow(publicKey: PublicKey) {
    return withNodeFailover("Account fetch", async () => {
        const result = await fetchAccount({ publicKey });
        if (result.error || !result.account) {
            throw new Error(
                `Could not fetch account ${publicKey.toBase58()}: ` +
                    `${result.error?.statusText ?? "not found in ledger"}`,
            );
        }
        return result.account;
    });
}

export async function initMinaClientContext(
    watchedAddress: PublicKey,
    network: MinaNetwork,
): Promise<MinaClientContext> {
    setMinaNetwork(network);

    await fetchAccountOrThrow(watchedAddress);

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
    await fetchAccountOrThrow(ctx.watchedAddress);
    return Number(ctx.settlementContract.blockHeight.get().toString());
}
