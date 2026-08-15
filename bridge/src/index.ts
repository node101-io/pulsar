import "dotenv/config";
import "./common/httpDefaults.js";
import { initDb } from "./db/connection.js";
import { masterRunner } from "./workers/bridge-tx-sender/master.js";
import { startPusher } from "./services/pulsar/pusher.js";
import logger from "./common/logger.js";

async function main() {
    await initDb();
    logger.info("Bridge TX sender started.");
    // The pusher runs beside the master forever, or returns immediately when
    // disabled. Promise.all, NOT race: race would settle on the disabled
    // pusher's early return and then swallow a later masterRunner rejection —
    // a dead master with a live-looking process. all() propagates whichever
    // side rejects, whenever it rejects.
    await Promise.all([startPusher(), masterRunner()]);
}

main().catch((err) => {
    logger.error("Fatal error in bridge", { error: err });
    process.exit(1);
});
