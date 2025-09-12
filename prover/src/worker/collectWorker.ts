import { createWorker } from "./worker.js";
import { CollectSignatureJob, reduceQ } from "../workerConnection.js";
// import logger from "../logger.js";
import fetch from "node-fetch";
import { fetchAccount, PublicKey, Signature } from "o1js";
import {
    CalculateFinalActionState,
    PulsarAction,
    PulsarEncoder,
    SettlementContract,
    ValidateReducePublicInput,
    VALIDATOR_NUMBER,
} from "pulsar-contracts";
import dotenv from "dotenv";
import { getOrCreateActionBatch, updateActionBatchStatus } from "../db.js";
import {
    DirectSecp256k1Wallet,
    encodePubkey,
    makeAuthInfoBytes,
    makeSignDoc,
} from "@cosmjs/proto-signing";
import { fromBase64, fromHex } from "@cosmjs/encoding";
import { StargateClient } from "@cosmjs/stargate";
import { MsgResolveActions, protobufPackage } from "../generated/interchain_security/bridge/tx.js";
import { PulsarAction as CosmosPulsarAction } from "../generated/interchain_security/bridge/state.js";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { encodeSecp256k1Pubkey } from "cosmwasm";

dotenv.config();

interface CollectOptions {
    maxRounds?: number;
    backoffMs?: number;
}

interface GetSignatureResponse {
    validatorPublicKey: string;
    signature: string;
    publicInput: string;
    mask: boolean[];
    isValid?: boolean;
    cached: boolean;
}

const contractInstance = new SettlementContract(
    PublicKey.fromBase58(process.env.CONTRACT_ADDRESS || "")
);

await createWorker<CollectSignatureJob, void>({
    queueName: "collect-signature",
    jobHandler: async ({ data, id }) => {
        const { blockHeight, actions } = data;

        try {
            const { isNew, batch } = await getOrCreateActionBatch(actions);

            if (!isNew) {
                // logger.debug("Action batch already exists", {
                //     jobId: id,
                //     batchId: batch?.id,
                //     status: batch?.status,
                //     blockHeight,
                //     actionsCount: actions.length,
                //     event: "existing_action_batch",
                // });
                console.log("Action batch already exists");
                if (
                    batch?.status === "settled" ||
                    batch?.status === "reducing" ||
                    batch?.status === "reduced"
                ) {
                    // logger.info("Actions already settled, skipping", {
                    //     jobId: id,
                    //     blockHeight,
                    //     batchId: batch?.id,
                    //     event: "actions_already_settled",
                    // });
                    console.log(`Batch status is ${batch?.status}, skipping`);
                    return;
                }

                const stuckThreshold = 10 * 60 * 1000; // 10 minutes
                const isStuck =
                    batch &&
                    batch.status === "collecting" &&
                    Date.now() - batch.updatedAt.getTime() > stuckThreshold;

                if (!isStuck) {
                    // logger.info("Actions already being collected, skipping", {
                    //     jobId: id,
                    //     blockHeight,
                    //     batchId: batch?.id,
                    //     status: batch?.status,
                    //     event: "actions_already_collecting",
                    // });
                    console.log("Actions already being collected, skipping");
                    return;
                }

                // logger.warn("Retrying stuck collection", {
                //     jobId: id,
                //     blockHeight,
                //     batchId: batch?.id,
                //     stuckDuration: Date.now() - batch.updatedAt.getTime(),
                //     event: "retry_stuck_collection",
                // });
                console.log("Retrying stuck collection");
            }

            // logger.jobStarted(id, "collect-signature", {
            //     blockHeight,
            //     actionsCount: actions.length,
            //     workerId: "collectWorker",
            // });
            console.log("Job started", { blockHeight, actionsCount: actions.length });

            await fetchAccount({ publicKey: contractInstance.address });

            const pulsarActions = actions.map((a) => PulsarAction.fromRawAction(a.actions[0]));

            await sendResolveActions(pulsarActions, blockHeight);

            const finalActionState = CalculateFinalActionState(
                contractInstance.actionState.get(),
                pulsarActions
            ).toString();

            const signatureResponses = await collectSignatures(
                [process.env.PULSAR_SERVER_URL!],
                finalActionState
            );

            const includedActionEntries = Array.from(
                getIncludedActions(pulsarActions, signatureResponses[0].mask).entries()
            );
            const signatures = signatureResponses.map((r) => [
                Signature.fromJSON(JSON.parse(r.signature)),
                PublicKey.fromBase58(r.validatorPublicKey),
            ]);

            await updateActionBatchStatus(actions, "reducing");

            const reduceJobId = `reduce-${blockHeight}`;
            await reduceQ.add(
                reduceJobId,
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
                    jobId: reduceJobId,
                }
            );

            await updateActionBatchStatus(actions, "reducing", {
                reduceJobId,
            });

            // logger.info("Added reduce job for block height", {
            //     jobId: id,
            //     blockHeight,
            //     reduceJobId: jobId,
            //     signaturesCollected: signatures.length,
            //     includedActionsCount: includedActionEntries.length,
            //     event: "reduce_job_added",
            // });
            console.log("Added reduce job for block height", { blockHeight, reduceJobId });
        } catch (error) {
            // logger.jobFailed(id, "collect-signature", error as Error, {
            //     blockHeight,
            //     actionsCount: actions.length,
            //     workerId: "collectWorker",
            // });
            console.error("Job failed", error);
            throw error;
        }
    },
});

function getIncludedActions(pulsarActions: PulsarAction[], mask: boolean[]): Map<string, number> {
    const actionHashMap: Map<string, number> = new Map();
    for (let i = 0; i < pulsarActions.length; i++) {
        if (!mask[i]) continue;
        const action = pulsarActions[i];
        const key = action.unconstrainedHash().toString();
        actionHashMap.set(key, (actionHashMap.get(key) ?? 0) + 1);
    }
    return actionHashMap;
}

async function sendResolveActions(pulsarActions: PulsarAction[], blockHeight: number) {
    try {
        const rpcEndpoint = process.env.PULSAR_RPC_ENDPOINT;
        const privateKeyHex = process.env.PULSAR_PRIVATE_KEY_HEX;
        const chainId = process.env.PULSAR_CHAIN_ID;
        const merkleWitness = process.env.MERKLE_WITNESS;
        const feeAmount = process.env.PULSAR_FEE_AMOUNT;
        const feeDenom = process.env.PULSAR_FEE_DENOM;
        const gasLimit = process.env.PULSAR_GAS_LIMIT;

        if (
            !privateKeyHex ||
            !rpcEndpoint ||
            !chainId ||
            !merkleWitness ||
            !feeAmount ||
            !feeDenom ||
            !gasLimit
        ) {
            console.error(
                privateKeyHex,
                rpcEndpoint,
                chainId,
                merkleWitness,
                feeAmount,
                feeDenom,
                gasLimit
            );
            throw new Error("Missing Cosmos configuration in environment variables");
        }

        const privateKeyBytes = fromHex(privateKeyHex);
        const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, "consumer");
        const [account] = await wallet.getAccounts();

        const actions: CosmosPulsarAction[] = pulsarActions.map((action) => {
            let actionType = "";
            if (PulsarAction.isDeposit(action).toBoolean()) {
                actionType = "deposit";
            } else {
                actionType = "withdrawal";
            }

            return {
                publicKey: PulsarEncoder.toAddress(action.account),
                amount: action.amount.toString(),
                actionType: actionType,
                cosmosAddress: PulsarEncoder.bigintToHex(
                    action.pulsarAuth.cosmosAddress.toBigInt()
                ),
                cosmosSignature: PulsarEncoder.encodeSignature(action.pulsarAuth.cosmosSignature),
            };
        });

        console.log("Preparing to send actions:", actions);

        const msgValue = MsgResolveActions.fromPartial({
            creator: account.address,
            actions,
            nextBlockHeight: blockHeight.toString(),
            merkleWitness,
        });

        const msgBytes = MsgResolveActions.encode(msgValue).finish();

        const anyMsg = Any.fromPartial({
            typeUrl: `/${protobufPackage}.MsgResolveActions`,
            value: msgBytes,
        });
        const txBody = TxBody.fromPartial({
            messages: [anyMsg],
            memo: "ResolveActions",
        });

        const bodyBytes = TxBody.encode(txBody).finish();

        const qc = await StargateClient.connect(rpcEndpoint);
        const onChain = await qc.getAccount(account.address);
        if (!onChain) throw new Error(`Account ${account.address} not found on chain`);
        const { accountNumber, sequence } = onChain;

        const pubkeyAny = encodePubkey(encodeSecp256k1Pubkey(account.pubkey));
        const fee = [{ denom: feeDenom, amount: feeAmount }];
        const authInfoBytes = makeAuthInfoBytes(
            [{ pubkey: pubkeyAny, sequence }],
            fee,
            Number(gasLimit),
            undefined,
            account.address
        );

        const signDoc = makeSignDoc(bodyBytes, authInfoBytes, chainId, accountNumber);
        const signed = await wallet.signDirect(account.address, signDoc);

        const sigBytes =
            typeof (signed.signature.signature as any) === "string"
                ? fromBase64(signed.signature.signature as any)
                : (signed.signature.signature as unknown as Uint8Array);

        const txRaw = TxRaw.fromPartial({
            bodyBytes: signed.signed.bodyBytes,
            authInfoBytes: signed.signed.authInfoBytes,
            signatures: [sigBytes],
        });

        const txBytes = TxRaw.encode(txRaw).finish();

        const result = await qc.broadcastTx(txBytes);
        if (result.code !== 0) {
            throw new Error(`Broadcast failed with code ${result.code}: ${result.rawLog}`);
        }

        // logger.info("Resolve actions sent successfully to Cosmos", {
        //     txHash: result.transactionHash,
        //     code: result.code,
        //     height: result.height,
        //     actionsCount: actions.length,
        //     creator: account.address,
        //     event: "pulsar_resolve_actions_success",
        // });
        console.log("Resolve actions sent successfully to Cosmos", {
            txHash: result.transactionHash,
        });

        return result;
    } catch (error) {
        // logger.error("Failed to send resolve actions to Cosmos", error as Error, {
        //     url: process.env.PULSAR_RPC_ENDPOINT,
        //     actionsCount: pulsarActions.length,
        //     event: "pulsar_resolve_actions_failed",
        // });
        console.error(error);
        throw error;
    }
}

export async function collectSignatures(
    endpoints: string[],
    finalActionState: string,
    { maxRounds = Infinity, backoffMs = 2_000 }: CollectOptions = {}
): Promise<GetSignatureResponse[]> {
    console.log("Starting signature collection from endpoints:", endpoints);
    const minRequired = Math.ceil((VALIDATOR_NUMBER * 2) / 3);
    const got: Array<GetSignatureResponse> = [];
    const seen = new Set<string>();
    let remaining = endpoints;

    await fetchAccount({ publicKey: contractInstance.address });

    let round = 1;
    for (; round <= maxRounds && got.length < minRequired; round++) {
        // logger.debug("Starting signature collection round", {
        //     round,
        //     validatorsQueried: remaining.length,
        //     signaturesCollected: got.length,
        //     signaturesRequired: minRequired,
        //     event: "signature_collection_round",
        // });
        console.log("Starting signature collection round", {
            round,
            validatorsQueried: remaining.length,
        });

        const results = await Promise.all(
            remaining.map(async (url) => {
                try {
                    const r = await fetch(url + ":6000/getSignature", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            initialActionState: contractInstance.actionState.get().toString(),
                            finalActionState,
                        }),
                    });
                    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);

                    console.log(r);
                    const responseText = await r.text();
                    console.log("Response text:", responseText);
                    let data: GetSignatureResponse;

                    try {
                        data = JSON.parse(responseText) as GetSignatureResponse;
                        console.log("Parsed data:", data);
                    } catch (parseError) {
                        throw new Error(
                            `Invalid JSON response: ${responseText.substring(0, 100)}...`
                        );
                    }

                    if ("error" in data) {
                        throw new Error(`Server error: ${(data as any).error}`);
                    }

                    if (!data.cached || !data.signature || !data.validatorPublicKey) {
                        throw new Error("No cached signature available");
                    }

                    const validatorPublicKey = PublicKey.fromBase58(data.validatorPublicKey);
                    console.log("Validator public key:", validatorPublicKey.toBase58());
                    const signature = Signature.fromJSON(JSON.parse(data.signature));
                    console.log("Signature:", signature.toBase58());
                    const publicInput = ValidateReducePublicInput.fromJSON(
                        JSON.parse(data.publicInput || "{}")
                    );
                    console.log("Public input:", publicInput.toJSON());
                    if (signature.verify(validatorPublicKey, publicInput.hash().toFields())) {
                        return { url, data };
                    }
                    throw new Error("Signature verification failed");
                } catch (err) {
                    // logger.warn("Failed to fetch signature from validator", {
                    //     validatorUrl: url,
                    //     round,
                    //     error: err instanceof Error ? err.message : String(err),
                    //     event: "signature_fetch_failed",
                    // });
                    console.warn("Failed to fetch signature from validator", url, err);
                    return { url, data: undefined };
                }
            })
        );

        results
            .filter((r) => r.data && !seen.has(r.url))
            .forEach((r) => {
                seen.add(r.url);
                got.push(r.data!);
            });

        if (got.length >= minRequired) break;

        remaining = results.filter((r) => !r.data).map((r) => r.url);

        if (remaining.length && round < maxRounds) {
            await new Promise((res) => setTimeout(res, backoffMs * round));
        }
    }

    if (got.length < minRequired) {
        const error = new Error(`Got only ${got.length} signatures (need ${minRequired})`);
        // logger.error("Insufficient signatures collected", error, {
        //     signaturesCollected: got.length,
        //     signaturesRequired: minRequired,
        //     totalRounds: round - 1,
        //     validatorsQueried: endpoints.length,
        //     event: "insufficient_signatures",
        // });
        console.error(error);
        throw error;
    }

    // logger.info("Successfully collected signatures", {
    //     signaturesCollected: got.length,
    //     signaturesRequired: minRequired,
    //     totalRounds: round - 1,
    //     validatorsQueried: endpoints.length,
    //     event: "signatures_collected_successfully",
    // });
    console.log("Successfully collected signatures", { signaturesCollected: got.length });

    return got;
}
