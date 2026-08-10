import { Bool, Field, Poseidon } from 'o1js';
import { PulsarAction } from '../types/PulsarAction.js';

export {
  ACTION_LEAF_PREFIX_V2,
  APPROVAL_CURSOR_PREFIX_V2,
  hashPulsarActionLeafV2,
  foldApprovalCursor,
};

/**
 * SINGLE SOURCE OF TRUTH for the Pulsar-chain action-leaf convention.
 *
 * Mirrors x/bridge/types/action_to_field_element.go and the mina-signer-go
 * merklelist package in the chain repo: the chain hashes every scanned action
 * into a leaf and folds the leaves into actions_reduced_root. Pinned
 * digit-for-digit by Go-generated vectors in src/test/fixtures/ — never
 * inline the hash.
 *
 * Nothing enforces this across packages (no cross-package CI), so a change
 * here needs a grep of the other readers of the same root: the bridge's
 * services/pulsar/validActions.ts (fold verification, base64 wire) and the
 * prover's services/pulsar/client.ts (vote-extension ingest, raw field
 * bytes) — they decode the same chain value from two different transports.
 *
 * v2 "verdict leaf" convention, the ONLY convention in this package — v1's leaf SHAPE
 * (hashing an attacker-chosen Mina block height) died with the redesign and
 * must not be reintroduced. Differences from v1's shape, both load-bearing:
 * - the Mina block height is replaced by the chain's verdict (approved 0/1),
 *   and the leaf is appended for EVERY scanned action, so the signed chain
 *   list mirrors the L1 action queue position for position;
 * - the account is the ACTION's account, not the zkApp fee payer.
 *
 * The prefix STRINGS below are still "_v1", not a typo: the chain (PR #39)
 * kept the "_v1" prefix string for this redesigned leaf rather than bump to
 * "_v2", and a fresh testnet with no old v1-shaped data means there is no
 * collision risk. Only the prefix STRING is shared with v1 — the leaf INPUTS
 * are the v2 shape above. The `_V2` suffix on these symbol names refers to
 * our redesign version, not the wire prefix string.
 */
const ACTION_LEAF_PREFIX_V2 = 'pulsar_bridge_action_v1';
const APPROVAL_CURSOR_PREFIX_V2 = 'pulsar_bridge_actions_root_v1';

/**
 * Fully provable — runs inside ApprovalTailProgram AND in the bridge's
 * witness construction, one implementation for both. No .toBoolean(), no
 * bigint params: approved enters the hash as the Bool's 0/1 field element,
 * account.toFields() is [x, isOdd].
 */
function hashPulsarActionLeafV2(action: PulsarAction, approved: Bool): Field {
  return Poseidon.hashWithPrefix(ACTION_LEAF_PREFIX_V2, [
    approved.toField(),
    ...action.account.toFields(),
    action.type,
    action.amount,
  ]);
}

/**
 * One fold step onto the approval cursor — same merklelist shape as v1 with
 * the prefix bumped in lockstep. Single-step (not a loop over leaves) because
 * the circuit folds one leaf per consumed batch slot; zero applications leave
 * the cursor unchanged, which is the empty-fold case. The empty cursor is
 * Field(0) chain-side, but the reduce never folds from Field(0) — it always
 * starts from the contract's committed cursor.
 */
function foldApprovalCursor(cursor: Field, leaf: Field): Field {
  return Poseidon.hashWithPrefix(APPROVAL_CURSOR_PREFIX_V2, [cursor, leaf]);
}
