import { WithId } from "mongodb";
import { BlockDoc } from "../../db/interfaces";

export async function worker(task: WithId<BlockDoc>) {}
