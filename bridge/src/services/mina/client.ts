import { PublicKey } from "o1js";
import { SettlementContract } from "pulsar-contracts/build/src/SettlementContract.js";
import {
    activeNodeEndpoint,
    fetchCheckedAccount,
    setMinaNetwork,
} from "pulsar-contracts/build/src/utils/fetch.js";
import { ENDPOINTS } from "pulsar-contracts/build/src/utils/constants.js";
import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    contractAddress: PublicKey;
    contract: SettlementContract;
    network: MinaNetwork;
    /**
     * The daemon in use right now, re-read on access so a node failover is
     * followed instead of pinned to whatever init happened to reach.
     */
    readonly nodeEndpoint: string;
    archiveEndpoint: string;
    /** Cached zkapp state array (Field.toString()) from last fetchAccount. Index = @state declaration order. */
    zkappState: string[];
    /**
     * The account's five stored action states from the same fetchAccount
     * snapshot — [0] is the live action queue tip, [1..4] the archived
     * predecessors a reduce precondition may still match.
     */
    actionStateHistory: string[];
}

// SettlementContract @state declaration order
const STATE_INDEX = {
    actionState: 0,
    merkleListRoot: 1,
    stateRoot: 2,
    blockHeight: 3,
    approvalCursor: 4,
} as const;

export async function initMinaClientContext(): Promise<MinaClientContext> {
    const network: MinaNetwork = env.MINA_NETWORK;
    const contractAddressStr = env.CONTRACT_ADDRESS;

    const archiveEndpoint = ENDPOINTS.ARCHIVE[network];

    // setMinaNetwork internally calls Mina.setActiveInstance with the correct endpoints
    setMinaNetwork(network);

    logger.info("Mina network configured", {
        network,
        nodeEndpoint: activeNodeEndpoint(network),
        archiveEndpoint,
    });

    const contractAddress = PublicKey.fromBase58(contractAddressStr);
    const account = await fetchCheckedAccount(
        contractAddress,
        "Contract account fetch",
    );

    const zkappState = (account.zkapp?.appState ?? []).map((f: any) => f.toString());
    const actionStateHistory = (account.zkapp?.actionState ?? []).map((f: any) => f.toString());
    const contract = new SettlementContract(contractAddress);

    logger.info("Mina client initialized", {
        network,
        contractAddress: contractAddressStr,
        event: "mina_client_initialized",
    });

    return {
        contractAddress,
        contract,
        network,
        get nodeEndpoint() {
            return activeNodeEndpoint(network);
        },
        archiveEndpoint,
        zkappState,
        actionStateHistory,
    };
}

/**
 * Refreshes ctx.zkappState by fetching the account from the network.
 */
export async function refreshContractState(ctx: MinaClientContext): Promise<void> {
    const account = await fetchCheckedAccount(
        ctx.contractAddress,
        "Contract account refresh",
    );
    const appState = account.zkapp?.appState;
    if (!appState || appState.length === 0) {
        throw new Error("Contract has no zkapp state — is it deployed?");
    }
    ctx.zkappState = appState.map((f: any) => f.toString());
    ctx.actionStateHistory = (account.zkapp?.actionState ?? []).map(
        (f: any) => f.toString(),
    );
}

/**
 * The account's five stored action states (same snapshot as zkappState);
 * [0] is the live action queue tip. Pending work exists exactly when the
 * contract's own actionState (state[0]) differs from that tip.
 */
export function getActionStateHistory(ctx: MinaClientContext): string[] {
    return ctx.actionStateHistory;
}

/** Reads from cached zkappState — call refreshContractState() first if you need fresh data. */
export function getContractMerkleRoot(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.merkleListRoot];
}

export function getContractActionState(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.actionState];
}

/**
 * Slot 4: the prefix fold of the chain's v2 verdict-leaf chain this contract
 * has consumed — the anchor of the approval walk and the fromCursor of
 * BuildVerdictBatch. Same snapshot rule as the other getters.
 */
export function getContractApprovalCursor(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.approvalCursor];
}

/**
 * Reads from cached zkappState — use this when the height must be CONSISTENT
 * with merkleListRoot/actionState read from the same snapshot (a fresh fetch
 * could observe a newer settlement than the cached root).
 */
export function getContractSettledHeight(ctx: MinaClientContext): number {
    return Number(ctx.zkappState[STATE_INDEX.blockHeight]);
}
