export interface MockValidator {
    address: string;
    privateKeyBase58: string;
    stake: number;
}

export interface MockVoteExtBody {
    initialValidatorListHash: bigint;
    initialStateRoot: bigint;
    initialBlockHeight: number;
    newValidatorListHash: bigint;
    newStateRoot: bigint;
    newBlockHeight: number;
}

export interface MockVoteExt {
    index: string;
    height: number;
    validatorAddr: string;
    signature: Buffer;
    body: MockVoteExtBody;
}

export interface MockBlock {
    height: number;
    stateRoot: bigint;
    validatorListHash: bigint;
    validators: MockValidator[];
    voteExts: MockVoteExt[];
}
