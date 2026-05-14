import "dotenv/config";
import { initDb } from "./db/connection.js";
import { runStartup } from "./startup.js";
import { startMinaSync } from "./services/mina/sync.js";
import { initMinaNetwork } from "./services/mina/client.js";
import logger from "./common/logger.js";

async function main() {
    initMinaNetwork();
    await initDb();
    await runStartup();

    logger.info("Bridge node initialized.");

    startMinaSync();
}

main().catch((err) => {
    logger.error("Fatal error during initialization", { error: err });
    process.exit(1);
});
