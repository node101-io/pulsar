import { fetchAccount, PublicKey } from "o1js";
import {
    fetchBlockHeight,
    fetchRawActions,
    setMinaNetwork,
    SettlementContract,
} from "pulsar-contracts";
import logger from "../../logger.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    watchedAddress: PublicKey;
    settlementContract: SettlementContract;
    network: MinaNetwork;
}

export async function initMinaClientContext(
    watchedAddress: PublicKey,
    network: MinaNetwork,
): Promise<MinaClientContext> {
    setMinaNetwork(network);

    await fetchAccount({
        publicKey: watchedAddress,
    });

    const settlementContract = new SettlementContract(watchedAddress);

    logger.info("Initialized Mina client context", {
        network,
        watchedAddress: watchedAddress.toBase58(),
        event: "mina_client_initialized",
    });

    return {
        watchedAddress,
        settlementContract,
        network,
    };
}

export async function getCurrentMinaBlockHeight(
    network: MinaNetwork,
): Promise<number> {
    const height = await fetchBlockHeight(network);
    return height;
}

export async function fetchMinaActions(
    ctx: MinaClientContext,
): Promise<unknown[]> {
    const { watchedAddress, settlementContract, network } = ctx;

    await fetchAccount({ publicKey: watchedAddress });

    const fromActionState = settlementContract.actionState.get();

    let actions = await fetchRawActions(watchedAddress, fromActionState);

    logger.debug("Settlement contract state", {
        actionState: settlementContract.actionState.get().toString(),
        merkleListRoot: settlementContract.merkleListRoot.get().toString(),
        stateRoot: settlementContract.stateRoot.get().toString(),
        blockHeight: Number(settlementContract.blockHeight.get().toString()),
        depositListHash: settlementContract.depositListHash.get().toString(),
        withdrawalListHash: settlementContract.withdrawalListHash.get().toString(),
        accountActionState: settlementContract.account.actionState
            .get()
            .toString(),
        network,
        event: "mina_contract_state_debug",
    });

    logger.debug("Processing Mina actions", {
        fromActionState: fromActionState.toString(),
        actionsCount: actions?.length || 0,
        event: "mina_new_actions",
    });

    if (!actions || actions.length === 0) {
        actions = [];
    }

    return actions;
}

