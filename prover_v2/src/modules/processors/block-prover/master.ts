import { DB } from "../../db";
import { worker } from "./worker";
import { sleep } from "../../utils/functions";

export async function masterRunner() {
    const db = new DB();
    await db.initMongo();

    const task = await db.blocksCol.findOne(
        {
            status: "waiting",
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
