import "dotenv/config";
import { initDb } from "../../db/connection.js";
import { masterRunner } from "./master.js";
import logger from "../../common/logger.js";

async function main() {
    await initDb();
    logger.info("Bridge TX Sender worker process started.");
    await masterRunner();
}

main().catch((err) => {
    logger.error("Fatal error in bridge-tx-sender worker", { error: err });
    process.exit(1);
});
