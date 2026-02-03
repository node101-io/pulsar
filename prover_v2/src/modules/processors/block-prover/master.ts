import { DB } from "../../db";
import { worker } from "./worker";
import { sleep } from "../../utils/functions";
import { ProofStatus } from "../../db/types";

export async function masterRunner() {
    const db = new DB();
    await db.initMongo();

    const task = await db.blocksCol.findOne(
        {
            status: "waiting" as ProofStatus,
            timeoutAt: { $lt: new Date() },
        },
        {
            sort: { timeoutAt: -1 },
        },
    );

    if (task) {
        worker(task);
    } else {
        await sleep(1000);
        masterRunner();
    }
}
