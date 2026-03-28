export interface MockValidator {
    address: string;
    privateKeyBase58: string;
    stake: number;
}

export interface MockVoteExtBody {
    initialValidatorSetRoot: Buffer;
    initialStateRoot: Buffer;
    initialBlockHeight: number;
    newValidatorSetRoot: Buffer;
    newStateRoot: Buffer;
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
    stateRoot: Buffer;
    validatorSetRoot: Buffer;
    validators: MockValidator[];
    voteExts: MockVoteExt[];
}
