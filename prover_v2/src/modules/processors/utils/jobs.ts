import { BlockData } from "../../utils/interfaces.js";

interface BlockProverJob {
    height: number;
}

interface AggregatorJob {
    height: number;
    index: number;
    left: string;
    right: string;
}

interface SettlementProverJob {
    height: number;
    settlementProofId: string;
}

interface SettlerJob {
    height: number;
}

export type { BlockProverJob, AggregatorJob, SettlementProverJob, SettlerJob };
