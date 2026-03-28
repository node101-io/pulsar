import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { initDb } from "./modules/db/index.js";
import { runStartup } from "./startup.js";
import { startPulsarSync } from "./modules/pulsar/sync.js";
import { startMinaSync } from "./modules/mina/index.js";
import { masterRunner as blockProverRunner } from "./modules/processors/block-prover/index.js";
import { masterRunner as aggregatorRunner } from "./modules/processors/aggregator/index.js";
import { masterRunner as settlementProverRunner } from "./modules/processors/settlement-prover/index.js";
import { masterRunner as settlerRunner } from "./modules/processors/settler/index.js";
import logger from "./logger.js";

async function main() {
    await initDb();
    await runStartup();

    logger.info("Application initialized.");

    startPulsarSync();
    startMinaSync();
    blockProverRunner();
    aggregatorRunner();
    settlementProverRunner();
    settlerRunner();
}

main().catch((err) => {
    logger.error("Fatal error during initialization", { error: err });
    process.exit(1);
});
