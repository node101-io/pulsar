// TODO: Implement once Mina archive node API/format is confirmed
// The archive node endpoint and query format need to be determined

export interface MinaActionEntry {
    blockHeight: number;
    actions: object[];
}

export async function getLatestMinaHeight(): Promise<number> {
    // TODO: query Mina archive node for latest block height
    throw new Error("Not implemented: getLatestMinaHeight");
}

export async function fetchActionsByHeight(
    fromHeight: number,
    toHeight: number,
): Promise<MinaActionEntry[]> {
    // TODO: fetch all actions from Mina archive node in [fromHeight, toHeight]
    // grouped by block height, returning one entry per block that has actions
    throw new Error("Not implemented: fetchActionsByHeight");
}
