"use client";

// Deposits the user has sent on Mina but that Pulsar has not credited yet.
//
// Nothing on either chain can answer "is my deposit in flight". x/bridge emits
// no events, and a deposit's Mina height is consumed by the keeper and never
// reaches a transaction body — so a deposit is invisible from the moment it is
// signed until the credit appears, which is roughly two hours later. This is
// the only record of that window, and it lives in the browser because that is
// the only place that witnessed the send.
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
//     showing nothing rather than breaking the deposit it was meant to explain.
//   - Every mutation re-reads storage first, so two tabs cannot overwrite each
//     other with a stale snapshot, and a `storage` listener keeps both current.
//   - Records are keyed by Mina transaction hash, so recording the same deposit
//     twice is idempotent and forgetting one is safe to repeat.
//
// A record leaves only when the chain settles it or the user dismisses it.
// There is deliberately no expiry: a deposit that never settles is exactly the
// case a user most needs to still see.

import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

import type { BridgeTransfer } from "./utils";

export {
  forgetPendingDeposit,
  reconcilePendingDeposits,
  recordPendingDeposit,
  usePendingDeposits,
};
export type { PendingDeposit };

const STORAGE_KEY = "pulsar.pending-deposits.v1";

// Far more than a user can plausibly have in flight, and a ceiling on what a
// bug in a caller could grow this to. The oldest go first.
const MAX_RECORDS = 50;

// JSON has no bigint, so the amount is stored as its base-unit digits and
// re-read through the same validation as everything else.
const StoredDeposit = z.object({
  minaTxHash: z.string().min(1),
  /** The Auro account that sent it, so records never bleed between wallets. */
  minaSender: z.string().min(1),
  /** Where the chain will credit it — the registry's answer, not the wallet's. */
  destination: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  /** Pulsar height when it was sent; the watermark a credit must beat. */
  pulsarHeightAtSend: z.number().int().nonnegative().nullable(),
  /** Mina height when it was sent; a lower bound on where it landed. */
  minaHeightAtSend: z.number().int().nonnegative().nullable(),
  /** Only ever displayed, never used to decide whether something settled. */
  sentAt: z.number().int().positive(),
});

type StoredDeposit = z.infer<typeof StoredDeposit>;

type PendingDeposit = Omit<StoredDeposit, "amount"> & { amount: bigint };

// useSyncExternalStore compares snapshots by identity and re-renders forever if
// a fresh array comes back every call. Both the raw string it was parsed from
// and the array are kept so an unchanged store returns the very same array.
let cachedRaw: string | null = null;
let cachedDeposits: PendingDeposit[] = [];

const listeners = new Set<() => void>();

const EMPTY: PendingDeposit[] = [];

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be disabled outright. Nothing here is worth a broken page.
    return null;
  }
}

function writeStorage(records: StoredDeposit[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every valid pending deposit in storage, newest last.
 *
 * Invalid records are skipped rather than corrected: a half-understood record
 * is indistinguishable from a wrong one, and this file's whole purpose is to
 * never show a user a deposit that did not happen. They are cleaned out on the
 * next write, not here — rewriting storage during a read would notify
 * subscribers mid-render.
 */
function parse(raw: string | null): PendingDeposit[] {
  if (!raw) return EMPTY;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(decoded)) return EMPTY;

  const deposits: PendingDeposit[] = [];
  for (const entry of decoded) {
    const result = StoredDeposit.safeParse(entry);
    if (!result.success) continue;
    // Duplicate hashes cannot come from this module, but storage is shared with
    // whatever else may have written it. Keep the first and move on.
    if (deposits.some((d) => d.minaTxHash === result.data.minaTxHash)) continue;
    deposits.push({ ...result.data, amount: BigInt(result.data.amount) });
  }

  return deposits.length ? deposits : EMPTY;
}

function snapshot(): PendingDeposit[] {
  const raw = readStorage();
  if (raw === cachedRaw) return cachedDeposits;

  cachedRaw = raw;
  cachedDeposits = parse(raw);
  return cachedDeposits;
}

function serverSnapshot(): PendingDeposit[] {
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
function mutate(change: (current: PendingDeposit[]) => PendingDeposit[]) {
  if (typeof window === "undefined") return;

  const next = change(parse(readStorage())).slice(-MAX_RECORDS);
  const stored: StoredDeposit[] = next.map((deposit) => ({
    ...deposit,
    amount: deposit.amount.toString(),
  }));

  if (!writeStorage(stored)) return;

  // Point the cache at what was just written, so the next snapshot reflects it
  // even if reading back is unavailable.
  cachedRaw = JSON.stringify(stored);
  cachedDeposits = next;
  notify();
}

function recordPendingDeposit(deposit: PendingDeposit) {
  mutate((current) => [
    ...current.filter((d) => d.minaTxHash !== deposit.minaTxHash),
    deposit,
  ]);
}

function forgetPendingDeposit(minaTxHash: string) {
  mutate((current) => current.filter((d) => d.minaTxHash !== minaTxHash));
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

/** Pending deposits sent from `minaSender`, newest first. */
function usePendingDeposits(minaSender?: string | null): PendingDeposit[] {
  const all = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  // Memoised so the array is referentially stable while nothing changes —
  // callers put it in effect dependencies. Switching accounts changes
  // `minaSender` and recomputes, so no wallet ever sees another's deposits.
  return useMemo(
    () =>
      minaSender
        ? all.filter((d) => d.minaSender === minaSender).reverse()
        : EMPTY,
    [all, minaSender],
  );
}

/**
 * Which pending deposits the chain has now settled.
 *
 * Pure, and the one piece of logic here that can be wrong in a way a user would
 * believe, so it is deliberately conservative:
 *
 *   - A credit only counts if it arrived in a Pulsar block ABOVE the height
 *     recorded when the deposit was sent. Without that watermark an older
 *     credit of the same size would clear a deposit that is still in flight —
 *     the page would say "settled" about money that has not moved.
 *   - Each settled credit clears at most one pending record, so two deposits of
 *     the same amount need two credits, not one seen twice.
 *   - A record whose watermark is missing (the height read failed at send time)
 *     is never matched here. It stays visible until the user dismisses it,
 *     which is the honest outcome: unknown, not settled.
 *
 * Matching oldest-first makes the result independent of the order the chain
 * returns credits in.
 */
function reconcilePendingDeposits(
  pending: PendingDeposit[],
  settled: BridgeTransfer[],
): { settledHashes: string[]; stillPending: PendingDeposit[] } {
  const credits = settled
    .filter((transfer) => transfer.direction === "deposit")
    .sort((a, b) => a.height - b.height);

  const claimed = new Set<string>();
  const settledHashes: string[] = [];
  const stillPending: PendingDeposit[] = [];

  const oldestFirst = [...pending].sort((a, b) => a.sentAt - b.sentAt);

  for (const deposit of oldestFirst) {
    const watermark = deposit.pulsarHeightAtSend;
    const match =
      watermark === null
        ? undefined
        : credits.find(
            (credit) =>
              !claimed.has(credit.id) &&
              credit.amount === deposit.amount &&
              credit.height > watermark,
          );

    if (match) {
      claimed.add(match.id);
      settledHashes.push(deposit.minaTxHash);
    } else {
      stillPending.push(deposit);
    }
  }

  return { settledHashes, stillPending };
}
