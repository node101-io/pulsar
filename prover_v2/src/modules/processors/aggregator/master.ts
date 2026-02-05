import { ObjectId } from "mongodb";
import { DB } from "../../db";
import { sleep } from "../../utils/functions";
import { worker } from "./worker";

export interface Aggregation {
    left: ObjectId;
    right: ObjectId;
    index: number;
}

const patterns = [
    // leaf nodes aggregation
    { startNode: 0, aggregated: 0 },
    { startNode: 2, aggregated: 1 },
    { startNode: 4, aggregated: 2 },
    { startNode: 6, aggregated: 3 },
    { startNode: 8, aggregated: 4 },
    { startNode: 10, aggregated: 5 },
    { startNode: 12, aggregated: 6 },
    { startNode: 14, aggregated: 7 },
    // 1st level internal nodes aggregation
    { startNode: 16, aggregated: 8 },
    { startNode: 18, aggregated: 9 },
    { startNode: 20, aggregated: 10 },
    { startNode: 22, aggregated: 11 },
    // 2nd level internal nodes aggregation
    { startNode: 24, aggregated: 12 },
    { startNode: 26, aggregated: 13 },
    // 3rd level internal nodes aggregation (to root)
    { startNode: 28, aggregated: 14 },
];

export async function masterRunner() {
    const db = new DB();
    await db.initMongo();

    const orClauses = patterns.map((p) => ({
        $and: [
            { [`proofs.${p.startNode}`]: { $exists: true } },
            { [`proofs.${p.startNode + 1}`]: { $exists: true } },
            { [`status.${p.aggregated}`]: { $eq: "waiting" } },
        ],
    }));

    const task = await db.proofEpochsCol.findOne(
        {
            $or: orClauses,
            timeoutAt: { $gt: new Date() },
        },
        {
            sort: { timeoutAt: 1 },
        },
    );

    if (task) {
        const result = patterns.find((p) => {
            if (
                task.proofs[p.startNode] &&
                task.proofs[p.startNode + 1] &&
                !task.status[p.aggregated]
            ) {
                return true;
            }
            return false;
        });

        if (!result) throw new Error("No valid aggregation pattern found.");

        const aggregation: Aggregation = {
            left: task.proofs[result.startNode],
            right: task.proofs[result.startNode + 1],
            index: result.aggregated,
        };

        worker(task, aggregation);
    } else {
        await sleep(1000);
        masterRunner();
    }
}
