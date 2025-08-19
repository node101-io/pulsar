import { createWorker } from "./worker.js";
import { CollectSignatureJob, reduceQ } from "../workerConnection.js";
import logger from "../logger.js";
import fetch from "node-fetch";
import { fetchAccount, PublicKey, Signature } from "o1js";
import { CalculateMax, PulsarAction, SettlementContract, VALIDATOR_NUMBER } from "pulsar-contracts";
import { ENDPOINTS } from "../mock/mockEndpoints.js";
import dotenv from "dotenv";
import { getOrCreateActionBatch, updateActionBatchStatus } from "../db.js";
dotenv.config();

const contractInstance = new SettlementContract(
    PublicKey.fromBase58(process.env.CONTRACT_ADDRESS || "")
);

createWorker<CollectSignatureJob, void>({
    queueName: "collect-signature",
    jobHandler: async ({ data, id }) => {
        const { blockHeight, actions } = data;

        if (actions.length === 0) {
            logger.warn(`[Job ${id}] No actions found for block height: ${blockHeight}`);
            return;
        }

        try {
            const { isNew, batch } = await getOrCreateActionBatch(actions);

            if (!isNew) {
                if (batch?.status === "settled") {
                    logger.info(
                        `[Job ${id}] Actions for block ${blockHeight} already settled, skipping`
                    );
                    return;
                }

                if (batch?.status === "reducing" || batch?.status === "reduced") {
                    logger.info(
                        `[Job ${id}] Actions for block ${blockHeight} already being processed (status: ${batch.status}), skipping`
                    );
                    return;
                }

                const stuckThreshold = 10 * 60 * 1000; // 10 minutes
                const isStuck =
                    batch &&
                    batch.status === "collecting" &&
                    Date.now() - batch.updatedAt.getTime() > stuckThreshold;

                if (!isStuck) {
                    logger.info(
                        `[Job ${id}] Actions for block ${blockHeight} already being collected, skipping`
                    );
                    return;
                }

                logger.warn(`[Job ${id}] Retrying stuck collection for block ${blockHeight}`);
            }

            logger.info(`[Job ${id}] Requesting signatures for block height: ${blockHeight}`);
            console.log(`Actions: ${JSON.stringify(actions)}`);
            const includedActions = await getIncludedActions(actions);
            console.log(
                `Included Actions: ${JSON.stringify(Array.from(includedActions.entries()))}`
            );
            const includedActionEntries = Array.from(includedActions.entries());
            const signatures = await collectSignatures(ENDPOINTS, includedActions, {
                blockHeight,
                actions,
            });

            await updateActionBatchStatus(actions, "reducing");

            const jobId = `reduce-${blockHeight}`;
            reduceQ.add(
                jobId,
                {
                    includedActions: includedActionEntries,
                    signaturePubkeyArray: signatures.map(([signature, publicKey]) => [
                        signature.toBase58(),
                        publicKey.toBase58(),
                    ]),
                    actions,
                },
                {
                    attempts: 5,
                    backoff: {
                        type: "exponential",
                        delay: 5_000,
                    },
                    removeOnComplete: true,
                    jobId: jobId,
                }
            );
            await updateActionBatchStatus(actions, "reducing", {
                reduceJobId: jobId,
            });

            logger.info(`[Job ${id}] Added reduce job for block height: ${blockHeight}`);
        } catch (error) {
            logger.error(
                `[Job ${id}] Failed to collect signatures for block height ${blockHeight}: ${error}`
            );
            throw error;
        }
    },
});

interface CollectOptions {
    minRequired?: number;
    maxRounds?: number;
    backoffMs?: number;
}

export async function collectSignatures(
    endpoints: string[],
    includedActions: Map<string, number>,
    payload: {
        blockHeight: number;
        actions: {
            actions: string[][];
            hash: string;
        }[];
    },
    {
        minRequired = Math.ceil((VALIDATOR_NUMBER * 2) / 3),
        maxRounds = Infinity,
        backoffMs = 2_000,
    }: CollectOptions = {}
): Promise<Array<[Signature, PublicKey]>> {
    const got: Array<[Signature, PublicKey]> = [];
    const seen = new Set<string>();
    let remaining = endpoints;

    const typedActions = payload.actions.map((action: { actions: string[][]; hash: string }) => {
        return {
            action: PulsarAction.fromRawAction(action.actions[0]),
            hash: BigInt(action.hash),
        };
    });

    await fetchAccount({ publicKey: contractInstance.address });
    const { publicInput } = CalculateMax(includedActions, contractInstance, typedActions);

    for (let round = 1; round <= maxRounds && got.length < minRequired; round++) {
        // logger.info(`Round ${round}, querying ${remaining.length} validators`);

        const results = await Promise.all(
            remaining.map(async (url) => {
                try {
                    const r = await fetch(url + "/sign", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const data = (await r.json()) as {
                        blockHeight: number;
                        validatorPubKey: string;
                        signature: string;
                    };
                    if (!data.signature || !data.validatorPubKey) {
                        throw new Error("Invalid response format");
                    }
                    const validatorPubKey = PublicKey.fromBase58(data.validatorPubKey);
                    const signature = Signature.fromJSON(JSON.parse(data.signature));
                    if (signature.verify(validatorPubKey, publicInput.hash().toFields())) {
                        return { url, validatorPubKey, signature };
                    }
                    throw new Error("Signature verification failed");
                } catch (err) {
                    logger.error(`Error fetching signature from ${url}: ${err}`);
                    return { url, signature: undefined };
                }
            })
        );

        results
            .filter((r) => r.signature && !seen.has(r.url))
            .forEach((r) => {
                seen.add(r.url);
                got.push([r.signature!, r.validatorPubKey!]);
            });

        if (got.length >= minRequired) break;

        remaining = results.filter((r) => !r.signature).map((r) => r.url);

        if (remaining.length && round < maxRounds) {
            await new Promise((res) => setTimeout(res, backoffMs * round));
        }
    }

    if (got.length < minRequired) {
        throw new Error(`Got only ${got.length} signatures (need ${minRequired})`);
    }

    return got;
}

async function getIncludedActions(
    actions: { actions: string[][]; hash: string }[]
): Promise<Map<string, number>> {
    const typedActions = actions.map((action: { actions: string[][]; hash: string }) => {
        return {
            action: PulsarAction.fromRawAction(action.actions[0]),
            hash: BigInt(action.hash),
        };
    });

    const actionHashMap: Map<string, number> = new Map();
    for (const action of typedActions) {
        const key = action.action.unconstrainedHash().toString();
        actionHashMap.set(key, (actionHashMap.get(key) ?? 0) + 1);
    }
    return actionHashMap;
}
