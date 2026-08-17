import "dotenv/config";

// No o1js in this process. See workers/childProver.ts.
import { initDb } from "../../db/index.js";
import { masterRunner } from "./master.js";
import logger from "../../common/logger.js";

async function main() {
    await initDb();
    logger.info("Settlement-prover worker process started.");
    await masterRunner();
}

main().catch((err) => {
    logger.error("Fatal error in settlement-prover worker", { error: err });
    process.exit(1);
});
