import { fetchAccount, PublicKey } from "o1js";
import { SettlementContract } from "../../../../contracts/build/src/SettlementContract.js";
import {
    setMinaNetwork,
    fetchBlockHeight,
} from "../../../../contracts/build/src/utils/fetch.js";
import { ENDPOINTS } from "../../../../contracts/build/src/utils/constants.js";
import logger from "../../common/logger.js";

export type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export interface MinaClientContext {
    contractAddress: PublicKey;
    contract: SettlementContract;
    network: MinaNetwork;
    nodeEndpoint: string;
    archiveEndpoint: string;
}

export interface MinaActionEntry {
    blockHeight: number;
    actions: string[][]; // raw field arrays from archive, one per dispatched action
}

export async function initMinaClientContext(): Promise<MinaClientContext> {
    const network = (process.env.MINA_NETWORK ?? "lightnet") as MinaNetwork;
    const contractAddressStr = process.env.CONTRACT_ADDRESS;
    if (!contractAddressStr) throw new Error("CONTRACT_ADDRESS is not set");

    setMinaNetwork(network);

    const contractAddress = PublicKey.fromBase58(contractAddressStr);
    await fetchAccount({ publicKey: contractAddress });

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
        nodeEndpoint: ENDPOINTS.NODE[network],
        archiveEndpoint: ENDPOINTS.ARCHIVE[network],
    };
}

export async function getLatestMinaHeight(
    ctx: MinaClientContext,
): Promise<number> {
    return fetchBlockHeight(ctx.network);
}

export async function getContractMerkleRoot(
    ctx: MinaClientContext,
): Promise<string> {
    await fetchAccount({ publicKey: ctx.contractAddress });
    return ctx.contract.merkleListRoot.get().toString();
}

export async function getContractActionState(
    ctx: MinaClientContext,
): Promise<string> {
    await fetchAccount({ publicKey: ctx.contractAddress });
    return ctx.contract.actionState.get().toString();
}

export async function getContractActionListHash(
    ctx: MinaClientContext,
): Promise<string> {
    await fetchAccount({ publicKey: ctx.contractAddress });
    return ctx.contract.actionListHash.get().toString();
}

export async function fetchActionsByHeight(
    fromHeight: number,
    toHeight: number,
    ctx: MinaClientContext,
): Promise<MinaActionEntry[]> {
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
