import { describe, expect, it } from "vitest";

import { resolveConnectedWallet } from "./connected-wallet";

const mina = { type: "mina" as const, address: "B62qtest" };
const pulsar = { type: "pulsar" as const, address: "pulsar1test" };

describe("resolveConnectedWallet", () => {
  it("honors the preferred wallet while it is connected", () => {
    // Both connected: the view the user navigated in from decides, in both
    // directions — this is the case the Mina-first fallback used to swallow.
    expect(resolveConnectedWallet(mina, pulsar, "pulsar")).toBe(pulsar);
    expect(resolveConnectedWallet(mina, pulsar, "mina")).toBe(mina);
  });

  it("falls back when the preferred wallet has disconnected", () => {
    // A stale preference must not strand the screen on a wallet that cannot
    // sign; whatever is still connected takes over.
    expect(resolveConnectedWallet(mina, null, "pulsar")).toBe(mina);
    expect(resolveConnectedWallet(null, pulsar, "mina")).toBe(pulsar);
  });

  it("breaks ties Mina-first when no preference is given", () => {
    // The header has no view context; its ordering matches the connect list.
    expect(resolveConnectedWallet(mina, pulsar)).toBe(mina);
    expect(resolveConnectedWallet(mina, pulsar, null)).toBe(mina);
  });

  it("returns the only connected wallet regardless of preference", () => {
    expect(resolveConnectedWallet(null, pulsar)).toBe(pulsar);
    expect(resolveConnectedWallet(mina, null)).toBe(mina);
  });

  it("returns null when nothing is connected", () => {
    expect(resolveConnectedWallet(null, null)).toBeNull();
    expect(resolveConnectedWallet(null, null, "pulsar")).toBeNull();
  });
});
