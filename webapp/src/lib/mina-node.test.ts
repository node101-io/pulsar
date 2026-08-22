import { beforeEach, describe, expect, it, vi } from "vitest";

import { MINA_NODE_FALLBACK_URLS, MINA_RPC_URL } from "./constants";

const FALLBACK = MINA_NODE_FALLBACK_URLS[0];

// The sticky endpoint choice is module state, so each test gets a fresh
// module — otherwise one test's failover leaks into the next.
async function freshModule() {
  vi.resetModules();
  return import("./mina-node");
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("withMinaNodeFailover", () => {
  it("answers from the primary and stays there", async () => {
    const { withMinaNodeFailover, activeMinaNodeUrl } = await freshModule();

    const seen: string[] = [];
    const result = await withMinaNodeFailover("read", async (url) => {
      seen.push(url);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(seen).toEqual([MINA_RPC_URL]);
    expect(activeMinaNodeUrl()).toBe(MINA_RPC_URL);
  });

  it("moves to the fallback when the primary throws, and stays sticky", async () => {
    const { withMinaNodeFailover, activeMinaNodeUrl } = await freshModule();

    const seen: string[] = [];
    const result = await withMinaNodeFailover("read", async (url) => {
      seen.push(url);
      if (url === MINA_RPC_URL) throw new Error("BOOTSTRAP");
      return "from-fallback";
    });

    expect(result).toBe("from-fallback");
    expect(seen).toEqual([MINA_RPC_URL, FALLBACK]);
    expect(activeMinaNodeUrl()).toBe(FALLBACK);

    // The next read must NOT re-probe the dead primary: mid-outage that
    // spends the primary's timeout on every poll.
    seen.length = 0;
    await withMinaNodeFailover("read", async (url) => {
      seen.push(url);
      return "ok";
    });
    expect(seen).toEqual([FALLBACK]);
  });

  it("throws the LAST error on total failure and resets to the primary", async () => {
    const { withMinaNodeFailover, activeMinaNodeUrl } = await freshModule();

    await expect(
      withMinaNodeFailover("read", async (url) => {
        throw new Error(`down: ${url}`);
      }),
    ).rejects.toThrow(`down: ${FALLBACK}`);

    // Recovery starts from the endpoint we trust most, not from wherever the
    // walk happened to end.
    expect(activeMinaNodeUrl()).toBe(MINA_RPC_URL);
  });
});
