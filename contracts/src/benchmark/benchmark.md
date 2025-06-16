# Benchmark Report

This report summarizes the circuit analysis, compilation times, and per-step benchmark results for the **TODO** on a local Mina network that runs run NodeJS environment. The tests measure the time taken to create, prove, and verify game steps in a Mastermind-like application.

### Device Information

- **CPU**: Apple M2
- **RAM**: 16 GB

---

## Circuit Analysis & Compilation Times

### ValidateReduceProgram zkProgram Analysis

| Method           | Rows  |
| ---------------- | ----- |
| verifySignatures | 20788 |

### ActionStackProgram zkProgram Analysis

| Method         | Rows  |
| -------------- | ----- |
| proveIntegrity | 45003 |

### MultisigVerifierProgram zkProgram Analysis

| Method           | Rows      |
| ---------------- | --------- |
| mergeProofs      | 5967      |
| verifySignatures | 20853     |
| **Total**        | **26820** |

### SettlementContract Analysis

| Method     | Rows      |
| ---------- | --------- |
| initialize | 326       |
| settle     | 895       |
| deposit    | 1074      |
| withdraw   | 1075      |
| reduce     | 36564     |
| **Total**  | **40234** |
