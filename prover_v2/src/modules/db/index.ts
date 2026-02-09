export { initDb } from "./db.js";

// Block
export { BlockModel, type IBlock } from "./models/block/Block.js";
export {
    storeBlock,
    getBlock,
    fetchBlockRange,
    fetchLastStoredBlock,
    seedInitialBlocks,
} from "./models/block/utils.js";

// Proof
export { ProofModel, type IProof } from "./models/proof/Proof.js";
export { storeProof, getProof, deleteProof } from "./models/proof/utils.js";

// ProofEpoch
export {
    ProofEpochModel,
    type IProofEpoch,
} from "./models/proofEpoch/ProofEpoch.js";
export {
    getProofEpoch,
    storeProofInProofEpoch,
    deleteProofEpoch,
    incrementFailCount,
} from "./models/proofEpoch/utils.js";

// BlockEpoch
export {
    BlockEpochModel,
    type IBlockEpoch,
} from "./models/blockEpoch/BlockEpoch.js";
export {
    getBlockEpoch,
    storeBlockInBlockEpoch,
    updateBlockStatusInEpoch,
    deleteBlockEpoch,
    incrementBlockEpochFailCount,
} from "./models/blockEpoch/utils.js";

// Types
export type { ProofKind, ProofStatus, BlockStatus } from "./types.js";
