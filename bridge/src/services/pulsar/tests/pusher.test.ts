import { describe, it, expect, vi, beforeEach } from "vitest";

// The env module validates process.env at import; without this mock the test
// only passes on machines that happen to have a filled-in bridge/.env — the
// same convention as actionHashes.test.ts.
const { envMock } = vi.hoisted(() => ({
    envMock: {
        NODE_ENV: "test",
        MINA_NETWORK: "devnet",
        PULSAR_GRPC_ENDPOINT: "grpc.test:9090",
        PULSAR_FEE_AMOUNT: 5000,
        PULSAR_FEE_DENOM: "pmina",
        PULSAR_GAS_LIMIT: 300000,
        PUSH_INTERVAL_MS: 60000,
    },
}));
vi.mock("../../../config/env.js", () => ({ env: envMock }));

import {
    computePushDecision,
    classifyPushFailure,
    wrapperMargin,
} from "../pusher.js";

// The decision mirrors msg_server_push_new_actions.go's admission checks;
// every case here names the chain rule that would otherwise reject the tx.
describe("computePushDecision", () => {
    const base = {
        startBlockHeight: 100n,
        maxBlockRange: 1000n,
    };

    it("pushes to the tip when it is within range", () => {
        expect(
            computePushDecision({ ...base, cursor: 500n, tip: 800n }),
        ).toEqual({ kind: "push", target: 800n });
    });

    it("caps the target at cursor + max_block_range when far behind", () => {
        expect(
            computePushDecision({ ...base, cursor: 500n, tip: 9000n }),
        ).toEqual({ kind: "push", target: 1500n });
    });

    it("idles when the tip has not advanced past the cursor", () => {
        expect(
            computePushDecision({ ...base, cursor: 800n, tip: 800n }),
        ).toEqual({ kind: "idle" });
        expect(
            computePushDecision({ ...base, cursor: 800n, tip: 700n }),
        ).toEqual({ kind: "idle" });
    });

    it("idles while Mina has not reached start_block_height yet", () => {
        // tip < start: nothing is pushable yet, but nothing is wrong either.
        expect(
            computePushDecision({
                cursor: 0n,
                tip: 50n,
                startBlockHeight: 100n,
                maxBlockRange: 1000n,
            }),
        ).toEqual({ kind: "idle" });
    });

    it("flags the genesis deadlock: span cap cannot reach start_block_height", () => {
        // cursor + range < start ≤ tip — no admissible target exists; only a
        // genesis reseed or a range param bump fixes it. Must be loud, never
        // a quiet idle.
        expect(
            computePushDecision({
                cursor: 0n,
                tip: 543_000n,
                startBlockHeight: 542_000n,
                maxBlockRange: 1000n,
            }),
        ).toEqual({ kind: "unreachable_start" });
    });

    it("first push on a well-seeded fresh chain reaches past start", () => {
        // Genesis seeded latest_fetched just under the contract deploy
        // height — the intended production shape.
        expect(
            computePushDecision({
                cursor: 542_990n,
                tip: 543_100n,
                startBlockHeight: 542_991n,
                maxBlockRange: 1000n,
            }),
        ).toEqual({ kind: "push", target: 543_100n });
    });
});

describe("classifyPushFailure", () => {
    it("classifies on the bare code: the shipped cosmjs+SDK pair delivers no codespace and an empty rawLog", () => {
        // The shape production actually sees — it MUST classify, or every
        // benign race logs as an error.
        expect(classifyPushFailure(1108, "")).toBe("raced");
        expect(classifyPushFailure(1105)).toBe("wrapper_behind");
        for (const code of [1107, 1109, 1127])
            expect(classifyPushFailure(code)).toBe("config");
        expect(classifyPushFailure(11)).toBe("config"); // out of gas: same limit fails forever
        expect(classifyPushFailure(5)).toBe("unknown"); // e.g. insufficient funds
    });

    it("names a fail-fast on a contract-impossible action instead of shrugging", () => {
        // The chain refuses the whole push rather than folding a malformed
        // payload as a false leaf (chain team decision, PR #40 rejected). The
        // operator must be able to tell this apart from a transport fault:
        // it is deliberate, permanent until fixed, and not a bridge bug.
        for (const code of [1129, 1130, 1131, 1132, 1133])
            expect(classifyPushFailure(code)).toBe("chain_invariant");
        expect(classifyPushFailure(3, "invalid action amount: got -5")).toBe(
            "chain_invariant",
        );
    });

    it("falls back to the registered error text for nodes that still fill the log", () => {
        expect(
            classifyPushFailure(
                3,
                "failed to execute message; message index: 0: mina block height must advance past latest fetched height",
            ),
        ).toBe("raced");
        expect(classifyPushFailure(3, "mina block not finalized")).toBe(
            "wrapper_behind",
        );
        expect(classifyPushFailure(3, "out of gas in ...")).toBe("config");
        expect(classifyPushFailure(42, "insufficient funds")).toBe("unknown");
    });
});

// The wrapper indexes with its own (unqueryable) confirmation depth; the
// margin must converge onto it and follow it back down — otherwise the
// pusher either never lands a push (no margin) or permanently lags (margin
// never decays).
describe("tip margin self-tuning", () => {
    beforeEach(() => wrapperMargin.reset());

    it("starts at zero: the common case pays no lag", () => {
        expect(wrapperMargin.effectiveTip(1000n)).toBe(1000n);
    });

    it("widens by one step per wrapper rejection and converges", () => {
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(998n);
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(996n);
    });

    it("caps the margin so a broken wrapper cannot push it to infinity", () => {
        for (let i = 0; i < 100; i++) wrapperMargin.onRejected();
        expect(1000n - wrapperMargin.effectiveTip(1000n)).toBe(64n);
    });

    it("never yields a negative tip on a young chain", () => {
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1n)).toBe(0n);
    });

    it("decays one block after a streak of accepted pushes", () => {
        wrapperMargin.onRejected(); // margin 2
        for (let i = 0; i < 10; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(999n); // margin 1
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(999n); // streak not reached yet
        wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(1000n); // margin back to 0
    });

    it("a rejection resets the decay streak", () => {
        wrapperMargin.onRejected(); // margin 2
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        wrapperMargin.onRejected(); // margin 4, streak 0
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n)).toBe(996n); // no decay yet
    });
});
