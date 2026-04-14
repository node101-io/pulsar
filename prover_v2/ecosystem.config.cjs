// Production PM2 ecosystem — real Pulsar node, no mock chain.
// Usage: pm2 start ecosystem.config.cjs
// All processes read .env from the prover_v2 directory via dotenv.

"use strict";

module.exports = {
    apps: [
        {
            name: "pulsar-main",
            script: "./dist/src/index.js",
            node_args: "",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "pulsar-block-prover",
            script: "./dist/src/workers/block-prover/index.js",
            node_args: "--max-old-space-size=8192",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "pulsar-aggregator",
            script: "./dist/src/workers/aggregator/index.js",
            node_args: "--max-old-space-size=8192",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "pulsar-settlement-prover",
            script: "./dist/src/workers/settlement-prover/index.js",
            node_args: "--max-old-space-size=8192",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "pulsar-settler",
            script: "./dist/src/workers/settler/index.js",
            node_args: "--max-old-space-size=8192",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
    ],
};
