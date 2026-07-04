// DB types
export type ProofKind =
    | "blockProof"
    | "aggregation"
    | "txProving"
    | "settlement"
    | "txSending"
    | "done";
export type ProofStatus = "waiting" | "processing" | "done" | "failed";
export type BlockStatus = "waiting" | "processing" | "done" | "failed";

// Interface types
export interface VoteExt {
    validatorAddr: string;
    signature: string;
}

export interface ValidatorInfo {
    addr: string; // Mina PublicKey base58
    power: string; // voting power, decimal string
}

export interface BlockData {
    height: number;
    stateRoot: string;
    // Sorted in the chain's fold order (power ASC, consensus-address ASC) so
    // the circuit's recomputed validator-set root matches the committed hash.
    validators: ValidatorInfo[];
    validatorListHash?: string;
    actionsReducedRoot: string;
    voteExt: VoteExt[];
}
