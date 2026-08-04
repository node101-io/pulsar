"use strict";

module.exports = {
    apps: [
        {
            name: "bridge",
            script: "./dist/src/index.js",
            node_args: "--max-old-space-size=8192",
            autorestart: true,
            restart_delay: 3000,
            max_restarts: 20,
            watch: false,
        },
    ],
};
