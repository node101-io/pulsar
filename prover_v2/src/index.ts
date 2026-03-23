import { setBackend } from "o1js";
setBackend("native");

import { initDb } from "./modules/db/index.js";
import { runStartup } from "./startup.js";
import logger from "./logger.js";

async function main() {
    await initDb();
    await runStartup();

    logger.info("Application initialized.");

    // Start modules (pulsar sync, processors, etc.)
}

main().catch((err) => {
    logger.error("Fatal error during initialization", { error: err });
    process.exit(1);
});
