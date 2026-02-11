import { BlockData } from "../../utils/interfaces.js";

interface BlockProverJob {
    height: number;
}

interface AggregatorJob {
    height: number;
    index: number;
}

interface SettlerJob {
    // Proof epoch height whose settlement proof will be submitted
    height: number;
}

export type { BlockProverJob, AggregatorJob, SettlerJob };
