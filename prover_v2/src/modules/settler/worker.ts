import { WithId } from "mongodb";
import { ProofEpochDoc } from "../../db/interfaces";

export async function worker(task: WithId<ProofEpochDoc>) {}
