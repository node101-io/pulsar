import { describe, it, expect } from "vitest";
import { AGGREGATE_THRESHOLD } from "pulsar-contracts";

import { PROOF_EPOCH_SIZE } from "../constants.js";

/**
 * `SettlementContract.settle` asserts
 *   NewBlockHeight === InitialBlockHeight + AGGREGATE_THRESHOLD
 * so a proof epoch must span exactly that many blocks. The prover derives its
 * span from the aggregation tree shape (BLOCK_EPOCH_SIZE ×
 * PROOF_EPOCH_LEAF_COUNT) and the contract from a standalone constant, in a
 * different package, with nothing else tying them together.
 *
 * If they ever drift, every settlement is rejected on-chain as an account
 * precondition failure — which names neither constant and is indistinguishable
 * from a bad validator set or a stale nonce. This test is what keeps that from
 * reaching a deploy, so both sides are imported unmocked on purpose.
 */
describe("settlement invariants", () => {
    it("proof epoch spans exactly AGGREGATE_THRESHOLD blocks", () => {
        expect(PROOF_EPOCH_SIZE).toBe(AGGREGATE_THRESHOLD);
    });
});
