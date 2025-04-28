/* eslint-disable no-unused-vars */
interface BenchmarkResults {
  stepLength: number;
  totalSeconds: number;
  deployAndInitializeSeconds: number;
  acceptGameSeconds: number;
  baseGameSeconds: number;
  makeGuessSeconds: number[];
  giveClueSeconds: number[];
  isSolved: boolean;
  submitGameProofSeconds: number;
}
