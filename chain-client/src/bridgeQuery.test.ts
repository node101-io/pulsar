import { describe, it, expect } from "vitest";
import type { Metadata } from "@grpc/grpc-js";

import {
    HISTORICAL_HEIGHT_HEADER,
    fetchActionsReducedRoot,
    fetchBridgeParams,
    fetchLatestActionHashes,
} from "./bridgeQuery.js";

// Fake generated-client methods: capture the metadata and answer via the
// grpc callback, exactly the (request, metadata, callback) overload the
// helpers use.
function capture<TRes>(response: TRes) {
    const seen: (string | undefined)[] = [];
    const method = (
        _req: object,
        metadata: Metadata,
        cb: (err: null, res: TRes) => void,
    ) => {
        const values = metadata.get(HISTORICAL_HEIGHT_HEADER);
        seen.push(values.length ? String(values[0]) : undefined);
        cb(null, response);
        return {} as never;
    };
    return { seen, method };
}

describe("fetchLatestActionHashes", () => {
    const response = {
        start_mina_height: "46",
        latest_fetched_mina_height: "56",
        action_hashes: ["7"],
        action_hashes_cosmos_block_height: "1200",
    };

    it("sends no height header for an unpinned read", async () => {
        const { seen, method } = capture(response);
        const res = await fetchLatestActionHashes({
            latestActionHashes: method as never,
        });
        expect(res).toEqual(response);
        expect(seen).toEqual([undefined]);
    });

    it("pins a historical read via the standard height header", async () => {
        const { seen, method } = capture(response);
        await fetchLatestActionHashes(
            { latestActionHashes: method as never },
            900,
        );
        expect(seen).toEqual(["900"]);
    });
});

describe("fetchBridgeParams", () => {
    it("passes the params response through unparsed", async () => {
        const response = {
            params: { start_block_height: "542991", max_block_range: "1000" },
        };
        const method = (
            _req: object,
            cb: (err: null, res: typeof response) => void,
        ) => {
            cb(null, response);
            return {} as never;
        };
        await expect(
            fetchBridgeParams({ params: method as never }),
        ).resolves.toEqual(response);
    });
});

describe("fetchActionsReducedRoot", () => {
    it("passes the response through unparsed", async () => {
        const { seen, method } = capture({ actions_reduced_root: "7040" });
        const res = await fetchActionsReducedRoot(
            { actionsReducedRoot: method as never },
            41,
        );
        expect(res).toEqual({ actions_reduced_root: "7040" });
        expect(seen).toEqual(["41"]);
    });
});
