# Benchmark Report

`Provable.constraintSystem` row counts for every circuit in the package,
against the 65,536 per-method row limit. The in-circuit cost of the
redesign is measured, not assumed.

These tables are pinned by the `Circuit rows` test in
`src/test/SettlementContract.test.ts` — it re-measures the redesign circuits
with `analyzeMethods()` and fails if this file drifts, so retune decisions
(e.g. `APPROVAL_TAIL_CHUNK` in `src/utils/constants.ts`) can trust the numbers
here. Re-run `pnpm run test -- SettlementContract` after any circuit change and
copy the `[rows]` output in.

## Circuit Analysis

### ApprovalTailProgram zkProgram Analysis

| Method         | Rows |
| -------------- | ---- |
| proveBase      | 1921 |
| proveRecursive | 1921 |

### ApprovalQuorumProgram zkProgram Analysis

| Method           | Rows |
| ---------------- | ---- |
| verifySignatures | 5246 |

### SettleAttestProgram zkProgram Analysis

| Method | Rows |
| ------ | ---- |
| attest | 50   |

### ActionStackProgram zkProgram Analysis

| Method         | Rows |
| -------------- | ---- |
| proveBase      | 901  |
| proveRecursive | 901  |

### MultisigVerifierProgram zkProgram Analysis

| Method           | Rows     |
| ---------------- | -------- |
| mergeProofs      | 13       |
| verifySignatures | 9100     |
| **Total**        | **9113** |

### SettlementContract Analysis

| Method   | Rows      |
| -------- | --------- |
| settle   | 706       |
| deposit  | 1934      |
| withdraw | 1897      |
| reduce   | 23329     |
| **Total**| **27866** |

Every method here grew 62-84% on the move to o1js 3.0.0 (settle 418, deposit
1065, withdraw 1033, reduce 14401 under 2.15.0), while every zkProgram above is
byte-identical. That split is the whole explanation: Mesa raised the on-chain
state from 8 to 32 fields, so only circuits carrying an AccountUpdate's state
and preconditions pay for it. `reduce` now sits at 36% of the 65,536 limit,
up from 22% — still ample, but a retune reading this table should know the
headroom moved.
