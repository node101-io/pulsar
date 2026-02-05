import { ProofKind, ProofStatus } from "./types";
import { VoteExt } from "../utils/interfaces.js";
import { ObjectId } from "mongodb";

export interface ProofDoc extends Document {
    data: string;
}

export interface BlockDoc extends Document {
    height: number;
    status: ProofStatus;
    stateRoot: string;
    validators: string[];
    validatorListHash: string;
    voteExt: VoteExt[];
}

export interface ProofEpochDoc extends Document {
    height: number;
    proofs: ObjectId[];
    status: ProofStatus[];
    timeoutAt: Date;
    kind: ProofKind;
    failCount: number;
}
