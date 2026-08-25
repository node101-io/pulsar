// Production PM2 ecosystem — real Pulsar node, no mock chain.
// Usage: pm2 start ecosystem.config.cjs
// All processes read .env from the prover directory via dotenv.
//
// The instance counts live here rather than in `pm2 scale` calls because a
// scale applied by hand is invisible: `pm2 delete` and a host reboot both drop
// it, and nothing in the repo records what the counts were. That is how three
// block-provers became one on 2026-08-25, mid-recovery, with no trace of what
// had been lost.
//
// exec_mode is pinned to "fork" on purpose. pm2 switches to cluster mode on
// its own once instances > 1, and cluster mode is the wrong shape here: these
// are queue workers with no shared socket, and proving already runs in a child
// process of its own (o1js blocks the event loop in native wasm, so a job has
// to be killable independently of its worker).
//
// After changing a count, `pm2 delete all && pm2 start ecosystem.config.cjs`,
// then `pm2 save`. A plain restart keeps pm2's stored process list AND its
// stored environment — dotenv will not overwrite a variable pm2 already set,
// so an edited .env silently does nothing until the app is deleted and started
// again.
"use strict";

const worker = (name, path, instances) => ({
    name,
    script: path,
    instances,
    exec_mode: "fork",
    node_args: "--max-old-space-size=8192",
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 20,
    watch: false,
});

module.exports = {
    apps: [
        {
            name: "pulsar-main",
            script: "./dist/src/index.js",
            instances: 1,
            exec_mode: "fork",
            node_args: "",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        worker("pulsar-block-prover", "./dist/src/workers/block-prover/index.js", 3),
        worker("pulsar-aggregator", "./dist/src/workers/aggregator/index.js", 2),
        worker(
            "pulsar-settlement-prover",
            "./dist/src/workers/settlement-prover/index.js",
            3,
        ),
        // Exactly one, always. The settler pipelines sends from a single
        // fee-payer account, so it owns one nonce sequence; a second instance
        // signs the same nonce and every send but one is dropped.
        worker("pulsar-settler", "./dist/src/workers/settler/index.js", 1),
    ],
};
