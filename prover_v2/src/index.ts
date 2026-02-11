import { initDb } from "./modules/db/index.js";
import logger from "./logger.js";

async function main() {
    await initDb();

    logger.info("Application initialized.");

    // Start modules (pulsar sync, processors, etc.)
}

main().catch((err) => {
    logger.error("Fatal error during initialization", err);
    process.exit(1);
});
