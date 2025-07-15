import { createWorker } from "./worker.js";
import { CollectSignatureJob, reduceQ } from "../workerConnection.js";
import logger from "../logger.js";
import fetch from "node-fetch";
import { PublicKey, Signature } from "o1js";
import {
    PulsarAction,
    TestUtils,
    ValidateReducePublicInput,
    VALIDATOR_NUMBER,
} from "pulsar-contracts";
import { ENDPOINTS } from "../mock/mockEndpoints.js";

createWorker<CollectSignatureJob, void>({
    queueName: "collect-signature",
    jobHandler: async ({ data, id }) => {
        const { blockHeight, actions } = data;

        if (actions.length === 0) {
            logger.warn(`[Job ${id}] No actions found for block height: ${blockHeight}`);
            return;
        }

        try {
            logger.info(`[Job ${id}] Requesting signatures for block height: ${blockHeight}`);
            const includedActions = await getIncludedActions();
            const signatures = await collectSignatures(ENDPOINTS, includedActions, {
                blockHeight,
                actions,
            });

            reduceQ.add(
                "reduce-" + blockHeight,
                {
                    includedActions,
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
                }
            );
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
    const { publicInput } = TestUtils.CalculateFromMockActions(
        ValidateReducePublicInput.default, // Todo: use correct public input
        typedActions
    );

    for (let round = 1; round <= maxRounds && got.length < minRequired; round++) {
        logger.info(`Round ${round}, querying ${remaining.length} validators`);

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
                    const signature = Signature.fromJSON(data.signature);
                    if (signature.verify(validatorPubKey, publicInput.hash().toFields())) {
                        return { url, validatorPubKey, signature };
                    }
                    throw new Error("Signature verification failed");
                } catch (e: any) {
                    logger.warn(`Validator ${url} failed: ${e.message}`);
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

async function getIncludedActions(): Promise<Map<string, number>> {
    return new Map();
}
