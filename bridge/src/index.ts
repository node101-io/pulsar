import "dotenv/config";
import { initDb } from "./db/connection.js";
import { masterRunner } from "./workers/bridge-tx-sender/master.js";
import logger from "./common/logger.js";

async function main() {
    await initDb();
    logger.info("Bridge TX sender started.");
    await masterRunner();
}

main().catch((err) => {
    logger.error("Fatal error in bridge", { error: err });
    process.exit(1);
});
