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
| settle   | 418       |
| deposit  | 1065      |
| withdraw | 1033      |
| reduce   | 14401     |
| **Total**| **16917** |
