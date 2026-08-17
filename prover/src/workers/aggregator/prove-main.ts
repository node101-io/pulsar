import "dotenv/config";
import { setBackend } from "o1js";
setBackend("native");

import { Types } from "mongoose";

import { initDb } from "../../db/index.js";
import { runAsProvingChild } from "../childProver.js";
import { ensureCompiled, proveAggregation } from "./proving.js";

/** One proof merge, run as a child.
 *  usage: prove-main.js <epochHeight> <leftProofId> <rightProofId> <index> */
runAsProvingChild("aggregator", async () => {
    const [heightArg, leftArg, rightArg, indexArg] = process.argv.slice(2);
    const height = Number(heightArg);
    const index = Number(indexArg);
    if (
        !Number.isInteger(height) ||
        !Number.isInteger(index) ||
        !leftArg ||
        !rightArg
    ) {
        throw new Error(
            "usage: prove-main.js <epochHeight> <leftProofId> <rightProofId> <index>",
        );
    }
    await initDb();
    await ensureCompiled();
    await proveAggregation(
        height,
        new Types.ObjectId(leftArg),
        new Types.ObjectId(rightArg),
        index,
    );
});
