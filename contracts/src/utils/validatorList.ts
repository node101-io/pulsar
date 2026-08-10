import { Field, Poseidon, PublicKey } from 'o1js';
import { List } from '../types/common.js';

export { VALIDATOR_LEAF_PREFIX, hashValidatorLeaf, computeValidatorListHash };

/**
 * SINGLE SOURCE OF TRUTH for the validator-set leaf convention.
 *
 * The circuits (ApprovalQuorumProgram, MultisigVerifierProgram) rebuild the
 * validator MerkleList leaf-by-leaf with hashValidatorLeaf and assert the fold
 * equals the committed root, so every off-chain producer of that root (chain,
 * prover ingest, bridge, deploy/seed scripts) must use these exact functions.
 * Change the convention here and everywhere follows — never inline the hash.
 */
const VALIDATOR_LEAF_PREFIX = 'pulsar-validator';

function hashValidatorLeaf(publicKey: PublicKey, power: Field): Field {
  return Poseidon.hashWithPrefix(VALIDATOR_LEAF_PREFIX, [
    ...publicKey.toFields(),
    power,
  ]);
}

/**
 * Fold the ordered validator set (chain fold order: power ASC, then
 * consensus-address ASC) into the MerkleList root the circuits verify.
 */
function computeValidatorListHash(
  validators: Array<{ publicKey: PublicKey; power: Field }>
): Field {
  const list = List.empty();
  for (const { publicKey, power } of validators) {
    list.push(hashValidatorLeaf(publicKey, power));
  }
  return list.hash;
}
