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

    it("separates a wrapper outage from our own faults", () => {
        // Nothing is wrong with the request — retrying is the right answer,
        // so it must not read as a config fault the operator chases.
        for (const code of [1115, 1116, 1135])
            expect(classifyPushFailure(code)).toBe("wrapper_down");
    });

    it("catches an underpaid fee, the quietest possible stall", () => {
        // Refused in CheckTx: no fee taken, no balance drain, and the next
        // tick re-sends the identical tx. Left as 'unknown' it would repeat
        // forever with nothing to notice.
        expect(classifyPushFailure(13)).toBe("config");
        expect(classifyPushFailure(3, "insufficient fee: got 30, want 200")).toBe(
            "config",
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

// The wrapper trails the tip by a KNOWN part (params.confirmation_depth) and
// an unknown one (the archive node's indexing lag). The known part must be
// used as-is — discovering the live chain's depth of 40 two blocks at a time
// would burn 20 rejected, fee-paying pushes — while the unknown part is what
// the slack discovers and gives back.
describe("wrapper lag targeting", () => {
    const DEPTH = 40n; // the deployed chain's params.confirmation_depth
    const EDGE = 3n; // standoff so targets never sit on the wrapper's boundary
    beforeEach(() => wrapperMargin.reset());

    it("subtracts the published confirmation depth from the very first tick", () => {
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(1000n - DEPTH - EDGE);
    });

    it("still stands off the edge when the chain publishes no depth", () => {
        expect(wrapperMargin.effectiveTip(1000n, 0n)).toBe(1000n - EDGE);
    });

    it("widens by one step per rejection, on top of the depth", () => {
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(1000n - DEPTH - EDGE - 2n);
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(1000n - DEPTH - EDGE - 4n);
    });

    it("caps the slack so a broken wrapper cannot widen it forever", () => {
        for (let i = 0; i < 100; i++) wrapperMargin.onRejected();
        expect(1000n - wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(
            DEPTH + EDGE + 64n,
        );
    });

    it("never yields a negative tip on a young chain", () => {
        wrapperMargin.onRejected();
        expect(wrapperMargin.effectiveTip(1n, DEPTH)).toBe(0n);
    });

    it("gives slack back after a streak of accepted pushes", () => {
        const base = 1000n - DEPTH - EDGE;
        wrapperMargin.onRejected(); // slack 2
        for (let i = 0; i < 10; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(base - 1n);
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(base - 1n); // streak not reached
        wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(base); // back to depth + edge
    });

    it("a rejection resets the decay streak", () => {
        wrapperMargin.onRejected(); // slack 2
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        wrapperMargin.onRejected(); // slack 4, streak 0
        for (let i = 0; i < 9; i++) wrapperMargin.onApplied();
        expect(wrapperMargin.effectiveTip(1000n, DEPTH)).toBe(
            1000n - DEPTH - EDGE - 4n,
        ); // no decay yet
    });
});
