export type ProofKind =
    | "blockProof"
    | "aggregation"
    | "txProving"
    | "settlement"
    | "txSending"
    | "done";
export type ProofStatus = "waiting" | "processing" | "done" | "failed";
export type BlockStatus = "waiting" | "processing" | "done" | "failed";
