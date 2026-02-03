import { DB } from "../../db";
import { sleep } from "../../utils/functions";
import { worker } from "./worker";

export async function masterRunner() {
    const db = new DB();
    await db.initMongo();

    const task = await db.proofEpochsCol.findOne(
        {
            // we used not and ne with elemMatch to achieve this
            // because MongoDB doesn't have a straightforward way
            // to check if all elements in an array match a condition
            // * check if all elements in status are "done" *
            $and: [
                { status: { $ne: [] } },
                { "status.0": { $exists: true } },
                { status: { $not: { $elemMatch: { $ne: "done" } } } },
            ],
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
