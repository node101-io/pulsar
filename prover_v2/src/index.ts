import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { initDb } from "./db/index.js";
import { runStartup } from "./startup.js";
import { startPulsarSync } from "./services/pulsar/sync.js";
import { startMinaSync } from "./services/mina/sync.js";
import { masterRunner as blockProverRunner } from "./workers/block-prover/master.js";
import { masterRunner as aggregatorRunner } from "./workers/aggregator/master.js";
import { masterRunner as settlementProverRunner } from "./workers/settlement-prover/master.js";
import { masterRunner as settlerRunner } from "./workers/settler/master.js";
import logger from "./common/logger.js";

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
