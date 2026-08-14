import { describe, expect, it } from "vitest";

import { reconcilePendingDeposits, type PendingDeposit } from "./pending-deposits";
import type { BridgeTransfer } from "./utils";

const deposit = (over: Partial<PendingDeposit> = {}): PendingDeposit => ({
  minaTxHash: "tx-1",
  minaSender: "B62qsender",
  destination: "pulsar1dest",
  amount: 5_000_000_000n,
  pulsarHeightAtSend: 100,
  minaHeightAtSend: 400,
  sentAt: 1_000,
  ...over,
});

const credit = (over: Partial<BridgeTransfer> = {}): BridgeTransfer => ({
  id: "hash-0",
  direction: "deposit",
  amount: 5_000_000_000n,
  height: 150,
  timestamp: "2026-08-14T00:00:00Z",
  txHash: "hash",
  ...over,
});

describe("reconcilePendingDeposits", () => {
  it("settles a deposit against a credit above its watermark", () => {
    const { settledHashes, stillPending } = reconcilePendingDeposits(
      [deposit()],
      [credit()],
    );

    expect(settledHashes).toEqual(["tx-1"]);
    expect(stillPending).toEqual([]);
  });

  it("ignores a credit that was already there when the deposit was sent", () => {
    // The whole reason a chain height is recorded: an identical earlier credit
    // must not clear a deposit that is still in flight.
    const { settledHashes, stillPending } = reconcilePendingDeposits(
      [deposit({ pulsarHeightAtSend: 200 })],
      [credit({ height: 150 })],
    );

    expect(settledHashes).toEqual([]);
    expect(stillPending).toHaveLength(1);
  });

  it("does not let one credit clear two deposits of the same amount", () => {
    const { settledHashes, stillPending } = reconcilePendingDeposits(
      [
        deposit({ minaTxHash: "tx-1", sentAt: 1_000 }),
        deposit({ minaTxHash: "tx-2", sentAt: 2_000 }),
      ],
      [credit()],
    );

    expect(settledHashes).toEqual(["tx-1"]);
    expect(stillPending.map((d) => d.minaTxHash)).toEqual(["tx-2"]);
  });

  it("clears both when both credits arrive", () => {
    const { settledHashes, stillPending } = reconcilePendingDeposits(
      [
        deposit({ minaTxHash: "tx-1", sentAt: 1_000 }),
        deposit({ minaTxHash: "tx-2", sentAt: 2_000 }),
      ],
      [credit({ id: "a", height: 150 }), credit({ id: "b", height: 160 })],
    );

    expect(settledHashes.sort()).toEqual(["tx-1", "tx-2"]);
    expect(stillPending).toEqual([]);
  });

  it("does not match a different amount", () => {
    const { settledHashes } = reconcilePendingDeposits(
      [deposit({ amount: 5_000_000_000n })],
      [credit({ amount: 4_000_000_000n })],
    );

    expect(settledHashes).toEqual([]);
  });

  it("never matches a withdrawal", () => {
    const { settledHashes } = reconcilePendingDeposits(
      [deposit()],
      [credit({ direction: "withdraw" })],
    );

    expect(settledHashes).toEqual([]);
  });

  it("leaves a deposit with no watermark pending rather than guessing", () => {
    const { settledHashes, stillPending } = reconcilePendingDeposits(
      [deposit({ pulsarHeightAtSend: null })],
      [credit()],
    );

    expect(settledHashes).toEqual([]);
    expect(stillPending).toHaveLength(1);
  });

  it("gives the same answer whatever order the chain returns credits in", () => {
    const pending = [
      deposit({ minaTxHash: "tx-1", sentAt: 1_000 }),
      deposit({ minaTxHash: "tx-2", sentAt: 2_000, amount: 7_000_000_000n }),
    ];
    const credits = [
      credit({ id: "a", height: 150 }),
      credit({ id: "b", height: 160, amount: 7_000_000_000n }),
    ];

    const forward = reconcilePendingDeposits(pending, credits);
    const reversed = reconcilePendingDeposits([...pending].reverse(), [...credits].reverse());

    expect(forward.settledHashes.sort()).toEqual(reversed.settledHashes.sort());
  });

  it("holds up with nothing on either side", () => {
    expect(reconcilePendingDeposits([], [])).toEqual({
      settledHashes: [],
      stillPending: [],
    });
    expect(reconcilePendingDeposits([], [credit()]).settledHashes).toEqual([]);
  });
});
