import "dotenv/config";
import { setBackend } from "o1js";
setBackend("wasm");

import { initDb } from "../../db/index.js";
import { runAsProvingChild } from "../childProver.js";
import { ensureCompiled, proveBlockEpoch } from "./proving.js";

/** One block-epoch proof, run as a child. usage: prove-main.js <blockEpochHeight> */
runAsProvingChild("block-prover", async () => {
    const height = Number(process.argv[2]);
    if (!Number.isInteger(height)) {
        throw new Error("usage: prove-main.js <blockEpochHeight>");
    }
    await initDb();
    await ensureCompiled();
    await proveBlockEpoch(height);
});
