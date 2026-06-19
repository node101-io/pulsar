"use strict";

module.exports = {
    apps: [
        {
            name: "bridge-main",
            script: "./dist/src/index.js",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
        {
            name: "bridge-tx-sender",
            script: "./dist/src/workers/bridge-tx-sender/index.js",
            node_args: "--max-old-space-size=512",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
    ],
};
