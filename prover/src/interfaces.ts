export interface VoteExt {
    index: string;
    height: number;
    validatorAddr: string;
    signature: string;
}

export interface BlockParserResult {
    blockId: string;
    blockHash: string;
    height: number;
    chainId: string;
    proposerAddress: string;
    time: Date;
    txs: string[];
    txsDecoded: string[];
    lastCommitSignatures: {
        validator_address: string;
        signature: string;
        timestamp: Date;
        block_id_flag: string;
    }[];
    hashes: {
        appHash: string;
        dataHash: string;
        validatorsHash: string;
        consensusHash: string;
        evidenceHash: string;
        lastCommitHash: string;
        lastResultsHash: string;
        nextValidatorsHash: string;
    };
}
