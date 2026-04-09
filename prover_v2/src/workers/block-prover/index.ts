import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { initDb } from "../../db/index.js";
import { masterRunner } from "./master.js";
import logger from "../../common/logger.js";

async function main() {
    await initDb();
    logger.info("Block-prover worker process started.");
    await masterRunner();
}

main().catch((err) => {
    logger.error("Fatal error in block-prover worker", { error: err });
    process.exit(1);
});
