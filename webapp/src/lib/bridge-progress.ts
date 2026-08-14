// Where a pending bridge transfer actually is, told from chain data.
//
// The wait between signing on Mina and the chain's answer has two distinct
// halves with different owners, and a progress line that conflates them
// misassigns blame:
//
//   1. CONFIRMING — Mina's tip has not yet climbed confirmation_depth blocks
//      past the transfer's block. Nothing on Pulsar can act; this is Mina
//      finality doing its job, and it is most of the total wait.
//   2. SCANNABLE — the block is old enough, but Pulsar's scan cursor has not
//      reached it yet. Now the wait IS on the bridge, and a stall here is a
//      bridge problem worth noticing.
//   3. SCANNING — the cursor is at or past the recorded height. The answer
//      should land with the next push; this phase lasting long is the one
//      genuinely suspicious state (the recorded height is a lower bound, so
//      it is never claimed as "done").
//
// All heights come from the same chains being described, never from a wall
// clock — the one estimate (minutes) is labelled as such and derived from
// Mina's nominal 3-minute slot, the only wall-clock fact used.

import type { PendingTransfer } from "./pending-transfers";

export type BridgeScanProgress = {
  /** Inclusive upper Mina height the chain has scanned, or null if unread. */
  cursor: number | null;
  /** Mina's current tip, or null if unread. */
  minaTip: number | null;
  /** x/bridge confirmation_depth, or null if unread. */
  confirmationDepth: number | null;
};

const MINA_SLOT_MINUTES = 3;

export function describePendingProgress(
  transfer: Pick<PendingTransfer, "minaHeightAtSend">,
  progress: BridgeScanProgress | undefined,
): string {
  const sentAt = transfer.minaHeightAtSend;
  const cursor = progress?.cursor ?? null;
  const minaTip = progress?.minaTip ?? null;
  const depth = progress?.confirmationDepth ?? null;

  // Phase 3 needs only the cursor, so it is decided first: once the scan has
  // reached the recorded height, confirmation arithmetic is history.
  if (cursor !== null && sentAt !== null && cursor >= sentAt) {
    return "Pulsar is scanning the blocks that carry it";
  }

  // Phase 1: the recorded height is a lower bound on the transfer's block, so
  // confirmations are measured against it. Slightly optimistic when the tx
  // landed a block or two later — which only makes phase 2 start a touch
  // early, never claims completion.
  if (sentAt !== null && minaTip !== null && depth !== null) {
    const scannableAt = sentAt + depth;
    if (minaTip < scannableAt) {
      const confirmations = Math.max(minaTip - sentAt, 0);
      const minutesLeft = (scannableAt - minaTip) * MINA_SLOT_MINUTES;
      return `Confirming on Mina — ${confirmations}/${depth} blocks (~${minutesLeft} min)`;
    }

    // Phase 2: old enough to read; the distance left is the bridge's to close.
    if (cursor !== null) {
      const behind = sentAt - cursor;
      return `Confirmed on Mina — Pulsar's scan is ${behind.toLocaleString()} block${behind === 1 ? "" : "s"} away`;
    }
    return "Confirmed on Mina — waiting for Pulsar's scan";
  }

  // Some reading is missing. Say only what is known to be true.
  return "Waiting for Pulsar to scan it";
}
