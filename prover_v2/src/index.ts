import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { initDb } from "./db/index.js";
import { runStartup } from "./startup.js";
import { startPulsarSync } from "./services/pulsar/sync.js";
import { startMinaSync } from "./services/mina/sync.js";
import logger from "./common/logger.js";

async function main() {
    await initDb();
    await runStartup();

    logger.info("Application initialized.");

    startPulsarSync();
    if (process.env.TEST_MODE !== "true") {
        startMinaSync();
    }
}

main().catch((err) => {
    logger.error("Fatal error during initialization", { error: err });
    process.exit(1);
});
