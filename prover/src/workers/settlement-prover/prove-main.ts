import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { Types } from "mongoose";

import { initDb } from "../../db/index.js";
import { runAsProvingChild } from "../childProver.js";
import { ensureCompiled, proveSettlement } from "./proving.js";

/** One settle-transaction proof, run as a child.
 *  usage: prove-main.js <epochHeight> <settlementProofId> */
runAsProvingChild("settlement-prover", async () => {
    const [heightArg, proofIdArg] = process.argv.slice(2);
    const height = Number(heightArg);
    if (!Number.isInteger(height) || !proofIdArg) {
        throw new Error("usage: prove-main.js <epochHeight> <settlementProofId>");
    }
    await initDb();
    await ensureCompiled();
    await proveSettlement(height, new Types.ObjectId(proofIdArg));
});
