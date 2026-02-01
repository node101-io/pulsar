import { ProofStatus } from "./types";
import { VoteExt } from "../utils/interfaces.js";

export interface ProofDoc extends Document {
    id: number;
    data: string;
}

export interface BlockDoc extends Document {
    height: number;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
}

export interface ProofEpochDoc extends Document {
    height: number;
    proofs: number[];
    status: ProofStatus[];
    timeoutAt: Date;
    failCount: number;
}
