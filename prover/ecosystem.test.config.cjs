// Test mode PM2 ecosystem — mock chain + prover stack (TEST_MODE=true).
// Usage: pm2 start ecosystem.test.config.cjs
// Requires TEST_MODE=true in .env.

"use strict";

module.exports = {
    apps: [
        {
            name: "mock-chain",
            script: "./dist/src/mock/index.js",
            node_args: "",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "pulsar-main",
            script: "./dist/src/index.js",
            node_args: "",
            autorestart: true,
            restart_delay: 5000, // give mock-chain time to start first
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
