import { PublicKey } from "o1js";

import {
    BLOCK_EPOCH_SIZE,
    WORKER_TIMEOUT_MS,
    STALLED_INTERVAL_MS,
    MASTER_SLEEP_INTERVAL_MS,
} from "../../config/constants.js";
import { ProofKind } from "../../common/types.js";
import {
    incrementProofEpochFailCount,
    ProofEpochModel,
} from "../../db/index.js";
import { Master } from "../master.js";
import { settlerQ } from "../queue.js";
import { SettlerJob } from "../types.js";
import { connection } from "../redis.js";
import { worker as processSettlement } from "./worker.js";
import { sleep } from "../../common/sleep.js";
import logger from "../../common/logger.js";
import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
    getContractBlockHeight,
} from "../../services/mina/client.js";

let minaCtx: MinaClientContext | null = null;

async function getMinaContext(): Promise<MinaClientContext> {
    if (!minaCtx) {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        if (!contractAddress) throw new Error("CONTRACT_ADDRESS is not set");
        const network: MinaNetwork =
            (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";
        minaCtx = await initMinaClientContext(
            PublicKey.fromBase58(contractAddress),
            network,
        );
    }
    return minaCtx;
}

export class SettlerMaster extends Master<SettlerJob> {
    constructor() {
        super({
            queueName: "settler",
            workerLabel: "Settler",
            connection,
            workerCount: 1,
            lockDurationMs: WORKER_TIMEOUT_MS,
            stalledIntervalMs: STALLED_INTERVAL_MS,
            processJob: async (_workerId, job) => {
                await processSettlement(job.data);
            },
            onJobFailed: async (job) => {
                if (job?.data.height) {
                    await incrementProofEpochFailCount(job.data.height);
                }
            },
        });
    }

    protected async handleTask(): Promise<void> {
        // Step 3a: is there an in-flight tx? if so, wait for it to land
        const inFlight = await ProofEpochModel.findOne({
            kind: { $eq: "txSending" as ProofKind },
        });
        if (inFlight) {
            logger.debug("Settlement tx in-flight, waiting", {
                epochHeight: inFlight.height,
                event: "settler_waiting_in_flight",
            });
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        // Fast path: any settlement-ready epochs at all?
        const hasPending = await ProofEpochModel.exists({
            kind: { $eq: "settlement" as ProofKind },
            timeoutAt: { $gt: new Date() },
        });
        if (!hasPending) {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
            return;
        }

        // Step 2: what is Mina's current onchain state?
        const ctx = await getMinaContext();
        const contractBlockHeight = await getContractBlockHeight(ctx);

        logger.debug("Checked on-chain settlement state", {
            contractBlockHeight,
            event: "settler_checked_onchain_state",
        });

        // Step 3b / 4: find the next epoch to settle, lowest height not yet settled on-chain
        const epoch = await ProofEpochModel.findOneAndUpdate(
            {
                kind: { $eq: "settlement" as ProofKind },
                timeoutAt: { $gt: new Date() },
                height: { $gt: contractBlockHeight - BLOCK_EPOCH_SIZE + 1 },
            },
            {
                $set: { kind: "txSending" as ProofKind },
            },
            {
                sort: { height: 1 },
                new: false,
            },
        );

        if (epoch) {
            try {
                await settlerQ.add("settler", { height: epoch.height });
                logger.debug(
                    `Pushed settler job to queue for epoch at height ${epoch.height}`,
                    {
                        epochHeight: epoch.height,
                        contractBlockHeight,
                        event: "settler_task_queued",
                    },
                );
            } catch (error) {
                await ProofEpochModel.updateOne(
                    { height: epoch.height, kind: "txSending" as ProofKind },
                    { $set: { kind: "settlement" as ProofKind } },
                );
                throw error;
            }
        } else {
            await sleep(MASTER_SLEEP_INTERVAL_MS);
        }
    }
}

export async function masterRunner() {
    const master = new SettlerMaster();
    await master.run();
}
