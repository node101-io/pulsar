import { describe, expect, it } from "vitest";

import { describePendingProgress } from "./bridge-progress";

const progress = (over: Partial<{ cursor: number | null; minaTip: number | null; confirmationDepth: number | null }> = {}) => ({
  cursor: 544_000,
  minaTip: 544_130,
  confirmationDepth: 40,
  ...over,
});

describe("describePendingProgress", () => {
  it("reports Mina confirmations while the block is too young to scan", () => {
    // Sent at 544_124, tip 544_130 → 6 confirmations, 34 blocks (~102 min) to
    // scannable. The wait belongs to Mina here, and the text says so.
    const text = describePendingProgress(
      { minaHeightAtSend: 544_124 },
      progress(),
    );

    expect(text).toBe("Confirming on Mina — 6/40 blocks (~102 min)");
  });

  it("never reports negative confirmations when the tip reading lags the send", () => {
    const text = describePendingProgress(
      { minaHeightAtSend: 544_140 },
      progress({ minaTip: 544_130 }),
    );

    expect(text).toContain("0/40 blocks");
  });

  it("moves the wait to the bridge once the block is old enough", () => {
    // Tip has passed sentAt + depth, cursor still behind sentAt: this is the
    // one state where a stall means a bridge problem, so the bridge owns it.
    const text = describePendingProgress(
      { minaHeightAtSend: 544_124 },
      progress({ minaTip: 544_170, cursor: 544_100 }),
    );

    expect(text).toBe("Confirmed on Mina — Pulsar's scan is 24 blocks away");
  });

  it("reports scanning once the cursor reaches the recorded height", () => {
    const text = describePendingProgress(
      { minaHeightAtSend: 544_124 },
      progress({ cursor: 544_124 }),
    );

    expect(text).toBe("Pulsar is scanning the blocks that carry it");
  });

  it("prefers the scanning phase over confirmation arithmetic", () => {
    // A cursor past the recorded height settles the question whatever the tip
    // and depth readings say — they may simply be stale.
    const text = describePendingProgress(
      { minaHeightAtSend: 544_124 },
      progress({ cursor: 544_200, minaTip: 544_130 }),
    );

    expect(text).toBe("Pulsar is scanning the blocks that carry it");
  });

  it("claims only what is known when readings are missing", () => {
    expect(
      describePendingProgress({ minaHeightAtSend: null }, progress()),
    ).toBe("Waiting for Pulsar to scan it");

    expect(
      describePendingProgress({ minaHeightAtSend: 544_124 }, undefined),
    ).toBe("Waiting for Pulsar to scan it");

    expect(
      describePendingProgress(
        { minaHeightAtSend: 544_124 },
        progress({ confirmationDepth: null }),
      ),
    ).toBe("Waiting for Pulsar to scan it");

    // Old enough per tip+depth, but no cursor reading: confirmed is provable,
    // the bridge's distance is not.
    expect(
      describePendingProgress(
        { minaHeightAtSend: 544_124 },
        progress({ minaTip: 544_170, cursor: null }),
      ),
    ).toBe("Confirmed on Mina — waiting for Pulsar's scan");
  });
});
