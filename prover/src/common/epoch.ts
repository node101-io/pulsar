import { PROOF_EPOCH_SIZE } from "../config/constants.js";

/**
 * Last Pulsar block covered by the proof epoch at `epochHeight`.
 *
 * The epoch spans blocks [epochHeight, epochHeight + PROOF_EPOCH_SIZE), proving
 * the transitions from `epochHeight - 1` up to this block — so settling it moves
 * the contract's blockHeight to exactly this value.
 *
 * The off-by-one matters: both settlement stages skip work when the contract has
 * already reached this height, and an inclusive-vs-exclusive mistake makes that
 * check miss by exactly one epoch, so the epoch that just landed is proved and
 * re-sent until it exhausts its retries.
 */
export function epochLastPulsarBlock(epochHeight: number): number {
    return epochHeight + PROOF_EPOCH_SIZE - 1;
}
