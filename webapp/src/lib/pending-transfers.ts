"use client";

// Bridge movements the user has signed on Mina but that Pulsar has not
// answered yet — deposits waiting on their credit, withdrawals waiting on
// their burn.
//
// Nothing on either chain can answer "is my transfer in flight". x/bridge
// emits no events, and an action's Mina height is consumed by the keeper and
// never reaches a transaction body — so both directions are invisible from the
// moment they are signed until the chain scans them, roughly two hours later.
// This is the only record of that window, and it lives in the browser because
// that is the only place that witnessed the send.
//
// The two directions resolve differently, and the store is honest about what
// each resolution means:
//
//   - A deposit leaves this store when its CREDIT appears — the money has
//     arrived, the story is over.
//   - A withdrawal leaves this store when its BURN appears — the pmina has
//     left Pulsar, and from that moment the Mina payout is the settlement
//     circuit's guarantee (reduce pays exactly the verdicts the chain
//     signed), no longer something this browser can influence or observe.
//     The burn is also when the movement enters on-chain history, where the
//     transactions page shows it.
//
// Because it is the only record, every path here is written so that no failure
// can turn it into a wrong one:
//
//   - Anything read out of storage is validated field by field. A record that
//     does not parse is dropped, never repaired by guesswork and never allowed
//     to throw on render — a page that crashes on one bad row would hide every
//     good one.
//   - Storage itself may be absent or throw (private windows, quota, a user who
//     disabled it). Every access is guarded, and the feature degrades to
//     showing nothing rather than breaking the transfer it was meant to
//     explain.
//   - Every mutation re-reads storage first, so two tabs cannot overwrite each
//     other with a stale snapshot, and a `storage` listener keeps both current.
//   - Records are keyed by Mina transaction hash, so recording the same
//     transfer twice is idempotent and forgetting one is safe to repeat.
//
// A record leaves only when the chain answers it or the user dismisses it.
// There is deliberately no expiry: a transfer that never settles is exactly
// the case a user most needs to still see — for a withdrawal doubly so, since
// an unanswered one means the 1 MINA down payment was forfeited.

import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

import type { BridgeTransfer } from "./utils";

export {
  forgetPendingTransfer,
  // Exported for its tests alone: the legacy-record shims in here guard money
  // records users already hold, which is exactly what must never regress.
  parse as parseStoredTransfers,
  reconcilePendingTransfers,
  recordPendingTransfer,
  usePendingTransfers,
  usePendingWithdrawalsFrom,
};
export type { PendingTransfer };

// The historical name predates withdrawals; changing it would orphan every
// record written under it, which is a worse outcome than an outdated string
// no user ever sees.
const STORAGE_KEY = "pulsar.pending-deposits.v1";

// Far more than a user can plausibly have in flight, and a ceiling on what a
// bug in a caller could grow this to. The oldest go first.
const MAX_RECORDS = 50;

// JSON has no bigint, so the amount is stored as its base-unit digits and
// re-read through the same validation as everything else.
const StoredTransfer = z.object({
  minaTxHash: z.string().min(1),
  /** The Auro account that signed it, so records never bleed between wallets. */
  minaSender: z.string().min(1),
  /**
   * The registered Pulsar account — where a deposit is credited, where a
   * withdrawal is burned from. Always the registry's answer, never the
   * connected wallet's.
   */
  pulsarAccount: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  // Records written before withdrawals existed carry no direction; every one
  // of them was a deposit, so the default is a fact rather than a guess.
  direction: z.enum(["deposit", "withdraw"]).default("deposit"),
  /** Pulsar height when it was sent; the watermark an answer must beat. */
  pulsarHeightAtSend: z.number().int().nonnegative().nullable(),
  /** Mina height when it was sent; a lower bound on where it landed. */
  minaHeightAtSend: z.number().int().nonnegative().nullable(),
  /** Only ever displayed, never used to decide whether something settled. */
  sentAt: z.number().int().positive(),
});

type StoredTransfer = z.infer<typeof StoredTransfer>;

type PendingTransfer = Omit<StoredTransfer, "amount"> & { amount: bigint };

// useSyncExternalStore compares snapshots by identity and re-renders forever if
// a fresh array comes back every call. Both the raw string it was parsed from
// and the array are kept so an unchanged store returns the very same array.
let cachedRaw: string | null = null;
let cachedTransfers: PendingTransfer[] = [];

const listeners = new Set<() => void>();

const EMPTY: PendingTransfer[] = [];

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be disabled outright. Nothing here is worth a broken page.
    return null;
  }
}

function writeStorage(records: StoredTransfer[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every valid pending transfer in storage, oldest first.
 *
 * Invalid records are skipped rather than corrected: a half-understood record
 * is indistinguishable from a wrong one, and this file's whole purpose is to
 * never show a user a transfer that did not happen. They are cleaned out on
 * the next write, not here — rewriting storage during a read would notify
 * subscribers mid-render.
 */
function parse(raw: string | null): PendingTransfer[] {
  if (!raw) return EMPTY;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(decoded)) return EMPTY;

  const transfers: PendingTransfer[] = [];
  for (const entry of decoded) {
    // Records from before the rename spelled this field `destination`. Same
    // value, same meaning — read it, and the next write stores the new name.
    const candidate =
      entry !== null &&
      typeof entry === "object" &&
      !("pulsarAccount" in entry) &&
      "destination" in entry
        ? { ...entry, pulsarAccount: (entry as { destination: unknown }).destination }
        : entry;

    const result = StoredTransfer.safeParse(candidate);
    if (!result.success) continue;
    // Duplicate hashes cannot come from this module, but storage is shared with
    // whatever else may have written it. Keep the first and move on.
    if (transfers.some((t) => t.minaTxHash === result.data.minaTxHash)) continue;
    transfers.push({ ...result.data, amount: BigInt(result.data.amount) });
  }

  return transfers.length ? transfers : EMPTY;
}

function snapshot(): PendingTransfer[] {
  const raw = readStorage();
  if (raw === cachedRaw) return cachedTransfers;

  cachedRaw = raw;
  cachedTransfers = parse(raw);
  return cachedTransfers;
}

function serverSnapshot(): PendingTransfer[] {
  // No storage on the server, and a stable reference keeps hydration quiet.
  return EMPTY;
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Applies `change` to whatever is in storage right now.
 *
 * Re-reads first every time: another tab may have added or dismissed a record
 * since this one rendered, and writing a remembered list back would silently
 * undo their work.
 */
function mutate(change: (current: PendingTransfer[]) => PendingTransfer[]) {
  if (typeof window === "undefined") return;

  const next = change(parse(readStorage())).slice(-MAX_RECORDS);
  const stored: StoredTransfer[] = next.map((transfer) => ({
    ...transfer,
    amount: transfer.amount.toString(),
  }));

  if (!writeStorage(stored)) return;

  // Point the cache at what was just written, so the next snapshot reflects it
  // even if reading back is unavailable.
  cachedRaw = JSON.stringify(stored);
  cachedTransfers = next;
  notify();
}

function recordPendingTransfer(transfer: PendingTransfer) {
  mutate((current) => [
    ...current.filter((t) => t.minaTxHash !== transfer.minaTxHash),
    transfer,
  ]);
}

function forgetPendingTransfer(minaTxHash: string) {
  mutate((current) => current.filter((t) => t.minaTxHash !== minaTxHash));
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  // Fires only in the OTHER tabs, which is exactly the gap notify() leaves.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cachedRaw = null;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Pending transfers signed by `minaSender`, newest first. */
function usePendingTransfers(minaSender?: string | null): PendingTransfer[] {
  const all = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  // Memoised so the array is referentially stable while nothing changes —
  // callers put it in effect dependencies. Switching accounts changes
  // `minaSender` and recomputes, so no wallet ever sees another's transfers.
  return useMemo(
    () =>
      minaSender
        ? all.filter((t) => t.minaSender === minaSender).reverse()
        : EMPTY,
    [all, minaSender],
  );
}

/**
 * Pending withdrawals that will burn from `pulsarAccount`, whichever Mina
 * wallet signed them.
 *
 * Keyed by the Pulsar side because that is where the danger lives: the chain
 * checks the account's balance when it SCANS the withdrawal, hours after
 * signing, and a balance that has shrunk below the amount by then forfeits
 * the down payment. Send flows subtract these from what they offer.
 */
function usePendingWithdrawalsFrom(
  pulsarAccount?: string | null,
): PendingTransfer[] {
  const all = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  return useMemo(
    () =>
      pulsarAccount
        ? all.filter(
            (t) => t.direction === "withdraw" && t.pulsarAccount === pulsarAccount,
          )
        : EMPTY,
    [all, pulsarAccount],
  );
}

/**
 * Which pending transfers the chain has now answered.
 *
 * Pure, and the one piece of logic here that can be wrong in a way a user
 * would believe, so it is deliberately conservative:
 *
 *   - An on-chain movement only counts if it matches the record's DIRECTION —
 *     a deposit resolves against its credit, a withdrawal against its burn.
 *     They are opposite movements of the same amounts, so ignoring direction
 *     would let one clear the other.
 *   - It only counts if it landed in a Pulsar block ABOVE the height recorded
 *     when the transfer was sent. Without that watermark an older movement of
 *     the same size would clear a transfer that is still in flight — the page
 *     would say "settled" about money that has not moved.
 *   - Each movement clears at most one pending record, so two transfers of
 *     the same amount need two answers, not one seen twice.
 *   - A record whose watermark is missing (the height read failed at send
 *     time) is never matched here. It stays visible until the user dismisses
 *     it, which is the honest outcome: unknown, not settled.
 *
 * Matching oldest-first makes the result independent of the order the chain
 * returns movements in.
 */
function reconcilePendingTransfers(
  pending: PendingTransfer[],
  settled: BridgeTransfer[],
): { settledHashes: string[]; stillPending: PendingTransfer[] } {
  const answers = [...settled].sort((a, b) => a.height - b.height);

  const claimed = new Set<string>();
  const settledHashes: string[] = [];
  const stillPending: PendingTransfer[] = [];

  const oldestFirst = [...pending].sort((a, b) => a.sentAt - b.sentAt);

  for (const transfer of oldestFirst) {
    const watermark = transfer.pulsarHeightAtSend;
    const match =
      watermark === null
        ? undefined
        : answers.find(
            (answer) =>
              !claimed.has(answer.id) &&
              answer.direction === transfer.direction &&
              answer.amount === transfer.amount &&
              answer.height > watermark,
          );

    if (match) {
      claimed.add(match.id);
      settledHashes.push(transfer.minaTxHash);
    } else {
      stillPending.push(transfer);
    }
  }

  return { settledHashes, stillPending };
}
