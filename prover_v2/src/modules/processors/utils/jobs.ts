import { BlockData } from "../../utils/interfaces.js";

interface BlockProverJob {
    height: number;
}

interface AggregatorJob {
    height: number;
}

interface SettlerJob {
    blockData: BlockData;
}

export type { BlockProverJob, AggregatorJob, SettlerJob };
