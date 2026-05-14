import { fetchBlockHeight, setMinaNetwork } from "pulsar-contracts";
import type { PulsarActionData } from "../../common/types.js";

type MinaNetwork = "devnet" | "mainnet" | "lightnet";

export function initMinaNetwork(): void {
    const network = (process.env.MINA_NETWORK ?? "lightnet") as MinaNetwork;
    setMinaNetwork(network);
}

export interface MinaActionEntry {
    blockHeight: number;
    actions: PulsarActionData[];
}

export async function getLatestMinaHeight(): Promise<number> {
    const network = (process.env.MINA_NETWORK ?? "lightnet") as MinaNetwork;
    return fetchBlockHeight(network);
}

export async function fetchActionsByHeight(
    _fromHeight: number,
    _toHeight: number,
): Promise<MinaActionEntry[]> {
    // archive node'dan block bazlı action sorgusu nasıl yapılacak henüz belli değil
    throw new Error("Not implemented: fetchActionsByHeight");
}

export async function getContractMerkleRoot(): Promise<string> {
    // mina graphql'den contract state'i çek
    throw new Error("Not implemented: getContractMerkleRoot");
}

export async function getContractActionState(): Promise<string> {
    throw new Error("Not implemented: getContractActionState");
}
