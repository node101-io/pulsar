import { Agent, setGlobalDispatcher } from "undici";

// minascan (both node and archive sit behind the same Cloudflare path)
// sometimes accepts the TCP connection and never answers. A response-less
// await throws nothing, so without deadlines such a call blocks whatever
// loop issued it (seen live 2026-08-15, twice, from two different hosts).
// This puts a ceiling on EVERY fetch in the process — o1js's internal ones
// included, which per-call wrappers can never reach. Stalls become thrown
// errors, which the transient-failure and archive-failover paths already
// know how to retry.
//
// Imported for its side effect by every process entrypoint (index.ts and
// the bridge-tx-sender job child).
setGlobalDispatcher(
    new Agent({
        connectTimeout: 10_000,
        headersTimeout: 60_000,
        // Idle gap between body chunks, not total download time — safe for
        // large-but-flowing archive responses.
        bodyTimeout: 60_000,
    }),
);
