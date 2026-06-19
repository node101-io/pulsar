export { initDb } from "./connection.js";

// Block
export { BlockModel, type IBlock, storeBlock, getBlock, fetchBlockRange, fetchLastStoredBlock } from "./models/Block.js";

// Proof
export { ProofModel, type IProof, storeProof, getProof, deleteProof } from "./models/Proof.js";

// ProofEpoch
export {
    ProofEpochModel,
    type IProofEpoch,
    getProofEpoch,
    storeProofInProofEpoch,
    deleteProofEpoch,
    incrementProofEpochFailCount,
} from "./models/ProofEpoch.js";

// BlockEpoch
export {
    BlockEpochModel,
    type IBlockEpoch,
    getBlockEpoch,
    storeBlockInBlockEpoch,
    updateBlockStatusInEpoch,
    deleteBlockEpoch,
    incrementBlockEpochFailCount,
} from "./models/BlockEpoch.js";

// MinaState
export { MinaStateModel, type IMinaState, saveMinaState, getMinaState } from "./models/MinaState.js";

// Types
export type { ProofKind, ProofStatus, BlockStatus } from "../common/types.js";
