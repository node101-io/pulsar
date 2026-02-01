import { DB } from "../../db";
import { sleep } from "../../utils/functions";
import { worker } from "./worker";

export async function masterRunner() {
    const db = new DB();
    await db.initMongo();

    const task = await db.proofEpochsCol.findOne(
        {
            status: { $elemMatch: { $eq: "waiting" } },
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
