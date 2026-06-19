import { fetchAccount, Mina, PublicKey } from "o1js";
import { SettlementContract } from "../../../../contracts/build/src/SettlementContract.js";
import { setMinaNetwork } from "../../../../contracts/build/src/utils/fetch.js";
import { ENDPOINTS } from "../../../../contracts/build/src/utils/constants.js";
import logger from "../../common/logger.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    contractAddress: PublicKey;
    contract: SettlementContract;
    network: MinaNetwork;
    nodeEndpoint: string;
    archiveEndpoint: string;
    /** Cached zkapp state array (Field.toString()) from last fetchAccount. Index = @state declaration order. */
    zkappState: string[];
}

export interface MinaActionEntry {
    blockHeight: number;
    actions: string[][];
}

// SettlementContract @state declaration order
const STATE_INDEX = {
    actionState: 0,
    merkleListRoot: 1,
    stateRoot: 2,
    blockHeight: 3,
    actionListHash: 4,
} as const;

export async function initMinaClientContext(): Promise<MinaClientContext> {
    const network = (process.env.MINA_NETWORK ?? "lightnet") as MinaNetwork;
    const contractAddressStr = process.env.CONTRACT_ADDRESS;
    if (!contractAddressStr) throw new Error("CONTRACT_ADDRESS is not set");

    const nodeEndpoint = ENDPOINTS.NODE[network];
    const archiveEndpoint = ENDPOINTS.ARCHIVE[network];

    // Configure contracts' o1js instance (needed for SettlementContract methods in txSender)
    setMinaNetwork(network);
    // Configure bridge's o1js instance (needed for fetchAccount in bridge)
    Mina.setActiveInstance(Mina.Network({ mina: nodeEndpoint, archive: archiveEndpoint }));

    logger.info("Mina network configured", { network, nodeEndpoint, archiveEndpoint });

    const contractAddress = PublicKey.fromBase58(contractAddressStr);
    const fetchResult = await fetchAccount({ publicKey: contractAddress });
    if (fetchResult.error != null) {
        throw new Error(`fetchAccount failed during init: ${fetchResult.error.statusText}`);
    }

    const zkappState = (fetchResult.account?.zkapp?.appState ?? []).map((f: any) => f.toString());
    const contract = new SettlementContract(contractAddress);

    logger.info("Mina client initialized", {
        network,
        contractAddress: contractAddressStr,
        event: "mina_client_initialized",
    });

    return { contractAddress, contract, network, nodeEndpoint, archiveEndpoint, zkappState };
}

/**
 * Uses daemonStatus instead of bestChain — bestChain hangs on some public endpoints.
 */
export async function getLatestMinaHeight(ctx: MinaClientContext): Promise<number> {
    const res = await fetch(ctx.nodeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ daemonStatus { blockchainLength } }" }),
    });
    if (!res.ok) throw new Error(`Node query failed: HTTP ${res.status}`);
    const { data, errors } = (await res.json()) as any;
    if (errors?.length) throw new Error(`GraphQL error: ${errors[0].message}`);
    const height: number = data?.daemonStatus?.blockchainLength;
    if (!height) throw new Error("daemonStatus returned no blockchainLength");
    return height;
}

/**
 * Refreshes ctx.zkappState by fetching the account from the network.
 */
export async function refreshContractState(ctx: MinaClientContext): Promise<void> {
    const result = await fetchAccount({ publicKey: ctx.contractAddress });
    if (result.error != null) {
        throw new Error(`fetchAccount failed: ${result.error.statusText}`);
    }
    const appState = result.account?.zkapp?.appState;
    if (!appState || appState.length === 0) {
        throw new Error("Contract has no zkapp state — is it deployed?");
    }
    ctx.zkappState = appState.map((f: any) => f.toString());
}

/** Reads from cached zkappState — call refreshContractState() first if you need fresh data. */
export function getContractMerkleRoot(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.merkleListRoot];
}

export function getContractActionState(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.actionState];
}

export function getContractActionListHash(ctx: MinaClientContext): string {
    return ctx.zkappState[STATE_INDEX.actionListHash];
}

export async function fetchActionsByHeight(
    fromHeight: number,
    toHeight: number,
    ctx: MinaClientContext,
): Promise<MinaActionEntry[]> {
    if (ctx.network === "lightnet") {
        return fetchActionsByHeightLightnet(fromHeight, toHeight, ctx);
    }

    const contractAddr = ctx.contractAddress.toBase58();

    const query = `{
        zkapps(query: {
            zkappCommand: {
                accountUpdates: {
                    body: { publicKey: "${contractAddr}" }
                }
            }
            blockHeight_gte: ${fromHeight}
            blockHeight_lte: ${toHeight}
            canonical: true
        }, sortBy: BLOCKHEIGHT_ASC) {
            blockHeight
            zkappCommand {
                accountUpdates {
                    body {
                        publicKey
                        actions
                    }
                }
            }
        }
    }`;

    const res = await fetch(ctx.archiveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    if (!res.ok) throw new Error(`Archive query failed: HTTP ${res.status}`);

    const { data, errors } = (await res.json()) as any;
    if (errors?.length)
        throw new Error(`Archive GraphQL error: ${errors[0].message}`);

    const zkapps: any[] = data?.zkapps ?? [];
    const byHeight = new Map<number, string[][]>();

    for (const zkapp of zkapps) {
        const height: number = zkapp.blockHeight;
        for (const update of zkapp.zkappCommand.accountUpdates) {
            if (update.body.publicKey !== contractAddr) continue;
            const actions: string[][] = update.body.actions ?? [];
            if (actions.length === 0) continue;

            const existing = byHeight.get(height) ?? [];
            byHeight.set(height, [...existing, ...actions]);
        }
    }

    return Array.from(byHeight.entries())
        .sort(([a], [b]) => a - b)
        .map(([blockHeight, actions]) => ({ blockHeight, actions }));
}

/**
 * lightnet archive-node-api uses `actions` query instead of `zkapps`.
 * Filters by height range client-side (archive doesn't support height filtering).
 */
async function fetchActionsByHeightLightnet(
    fromHeight: number,
    toHeight: number,
    ctx: MinaClientContext,
): Promise<MinaActionEntry[]> {
    const contractAddr = ctx.contractAddress.toBase58();

    const query = `{
        actions(input: { address: "${contractAddr}" }) {
            blockInfo { height }
            actionData { data }
        }
    }`;

    const res = await fetch(ctx.archiveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    if (!res.ok) throw new Error(`Archive query failed: HTTP ${res.status}`);

    const { data, errors } = (await res.json()) as any;
    if (errors?.length)
        throw new Error(`Archive GraphQL error: ${errors[0].message}`);

    const entries: any[] = data?.actions ?? [];
    const byHeight = new Map<number, string[][]>();

    for (const entry of entries) {
        const height: number = entry.blockInfo.height;
        if (height < fromHeight || height > toHeight) continue;

        for (const actionData of entry.actionData ?? []) {
            const fields: string[] = actionData.data ?? [];
            if (fields.length === 0) continue;

            const existing = byHeight.get(height) ?? [];
            byHeight.set(height, [...existing, fields]);
        }
    }

    return Array.from(byHeight.entries())
        .sort(([a], [b]) => a - b)
        .map(([blockHeight, actions]) => ({ blockHeight, actions }));
}
