import { describe, expect, it } from "vitest";

import {
  parseStoredTransfers,
  reconcilePendingTransfers,
  type PendingTransfer,
} from "./pending-transfers";
import type { BridgeTransfer } from "./utils";

const pending = (over: Partial<PendingTransfer> = {}): PendingTransfer => ({
  minaTxHash: "tx-1",
  minaSender: "B62qsender",
  pulsarAccount: "pulsar1account",
  amount: 5_000_000_000n,
  direction: "deposit",
  pulsarHeightAtSend: 100,
  minaHeightAtSend: 400,
  sentAt: 1_000,
  ...over,
});

const answer = (over: Partial<BridgeTransfer> = {}): BridgeTransfer => ({
  id: "hash-0",
  direction: "deposit",
  amount: 5_000_000_000n,
  height: 150,
  timestamp: "2026-08-14T00:00:00Z",
  txHash: "hash",
  ...over,
});

describe("reconcilePendingTransfers", () => {
  it("settles a deposit against a credit above its watermark", () => {
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [pending()],
      [answer()],
    );

    expect(settledHashes).toEqual(["tx-1"]);
    expect(stillPending).toEqual([]);
  });

  it("settles a withdrawal against its burn, and only its burn", () => {
    const withdrawal = pending({ direction: "withdraw" });

    // A deposit credit of the same amount is the opposite movement — it must
    // not clear a withdrawal, however alike the numbers look.
    const wrongDirection = reconcilePendingTransfers(
      [withdrawal],
      [answer({ direction: "deposit" })],
    );
    expect(wrongDirection.settledHashes).toEqual([]);

    const burn = reconcilePendingTransfers(
      [withdrawal],
      [answer({ direction: "withdraw" })],
    );
    expect(burn.settledHashes).toEqual(["tx-1"]);
  });

  it("does not let a burn clear a deposit", () => {
    const { settledHashes } = reconcilePendingTransfers(
      [pending({ direction: "deposit" })],
      [answer({ direction: "withdraw" })],
    );

    expect(settledHashes).toEqual([]);
  });

  it("ignores an answer that was already there when the transfer was sent", () => {
    // The whole reason a chain height is recorded: an identical earlier
    // movement must not clear a transfer that is still in flight.
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [pending({ pulsarHeightAtSend: 200 })],
      [answer({ height: 150 })],
    );

    expect(settledHashes).toEqual([]);
    expect(stillPending).toHaveLength(1);
  });

  it("does not let one answer clear two transfers of the same amount", () => {
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [
        pending({ minaTxHash: "tx-1", sentAt: 1_000 }),
        pending({ minaTxHash: "tx-2", sentAt: 2_000 }),
      ],
      [answer()],
    );

    expect(settledHashes).toEqual(["tx-1"]);
    expect(stillPending.map((t) => t.minaTxHash)).toEqual(["tx-2"]);
  });

  it("clears both when both answers arrive", () => {
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [
        pending({ minaTxHash: "tx-1", sentAt: 1_000 }),
        pending({ minaTxHash: "tx-2", sentAt: 2_000 }),
      ],
      [answer({ id: "a", height: 150 }), answer({ id: "b", height: 160 })],
    );

    expect(settledHashes.sort()).toEqual(["tx-1", "tx-2"]);
    expect(stillPending).toEqual([]);
  });

  it("resolves opposite directions of the same amount independently", () => {
    // One deposit and one withdrawal, same size, both in flight — each must
    // find its own kind of answer and leave the other's alone.
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [
        pending({ minaTxHash: "dep", direction: "deposit", sentAt: 1_000 }),
        pending({ minaTxHash: "wd", direction: "withdraw", sentAt: 2_000 }),
      ],
      [answer({ id: "burn", direction: "withdraw", height: 160 })],
    );

    expect(settledHashes).toEqual(["wd"]);
    expect(stillPending.map((t) => t.minaTxHash)).toEqual(["dep"]);
  });

  it("does not match a different amount", () => {
    const { settledHashes } = reconcilePendingTransfers(
      [pending({ amount: 5_000_000_000n })],
      [answer({ amount: 4_000_000_000n })],
    );

    expect(settledHashes).toEqual([]);
  });

  it("leaves a transfer with no watermark pending rather than guessing", () => {
    const { settledHashes, stillPending } = reconcilePendingTransfers(
      [pending({ pulsarHeightAtSend: null })],
      [answer()],
    );

    expect(settledHashes).toEqual([]);
    expect(stillPending).toHaveLength(1);
  });

  it("gives the same answer whatever order the chain returns movements in", () => {
    const transfers = [
      pending({ minaTxHash: "tx-1", sentAt: 1_000 }),
      pending({ minaTxHash: "tx-2", sentAt: 2_000, amount: 7_000_000_000n }),
    ];
    const answers = [
      answer({ id: "a", height: 150 }),
      answer({ id: "b", height: 160, amount: 7_000_000_000n }),
    ];

    const forward = reconcilePendingTransfers(transfers, answers);
    const reversed = reconcilePendingTransfers(
      [...transfers].reverse(),
      [...answers].reverse(),
    );

    expect(forward.settledHashes.sort()).toEqual(reversed.settledHashes.sort());
  });

  it("holds up with nothing on either side", () => {
    expect(reconcilePendingTransfers([], [])).toEqual({
      settledHashes: [],
      stillPending: [],
    });
    expect(reconcilePendingTransfers([], [answer()]).settledHashes).toEqual([]);
  });
});

describe("parseStoredTransfers", () => {
  it("reads records written before withdrawals existed", () => {
    // The exact shape the deposit-only store wrote: `destination` instead of
    // `pulsarAccount`, no `direction`. Both facts are recoverable — every such
    // record was a deposit — and a user's in-flight money must survive the
    // upgrade.
    const legacy = JSON.stringify([
      {
        minaTxHash: "old-tx",
        minaSender: "B62qsender",
        destination: "pulsar1account",
        amount: "5000000000",
        pulsarHeightAtSend: 100,
        minaHeightAtSend: 400,
        sentAt: 1_000,
      },
    ]);

    const [record] = parseStoredTransfers(legacy);
    expect(record).toMatchObject({
      minaTxHash: "old-tx",
      pulsarAccount: "pulsar1account",
      direction: "deposit",
      amount: 5_000_000_000n,
    });
  });

  it("drops what it cannot understand instead of guessing or throwing", () => {
    expect(parseStoredTransfers(null)).toEqual([]);
    expect(parseStoredTransfers("not json")).toEqual([]);
    expect(parseStoredTransfers('{"an":"object"}')).toEqual([]);

    // One bad record must not take the good one with it.
    const mixed = JSON.stringify([
      { minaTxHash: "", amount: "not-digits" },
      {
        minaTxHash: "good",
        minaSender: "B62qsender",
        pulsarAccount: "pulsar1account",
        amount: "1",
        direction: "withdraw",
        pulsarHeightAtSend: null,
        minaHeightAtSend: null,
        sentAt: 1,
      },
    ]);
    const records = parseStoredTransfers(mixed);
    expect(records).toHaveLength(1);
    expect(records[0].minaTxHash).toBe("good");
    expect(records[0].direction).toBe("withdraw");
  });
});
