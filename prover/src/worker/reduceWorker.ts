import { createWorker } from "./worker.js";
import { ReducerJob } from "../workerConnection.js";
import { updateActionBatchStatus } from "../db.js";
import {
    SignaturePublicKeyList,
    PrepareBatchWithActions,
    SettlementContract,
    GenerateValidateReduceProof,
    PulsarAction,
} from "pulsar-contracts";
import logger from "../logger.js";
import { fetchAccount, Mina, PrivateKey, PublicKey, Signature } from "o1js";

const settlementContractAddress = process.env.CONTRACT_ADDRESS;
const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
const fee = Number(process.env.FEE) || 1e8;
if (!settlementContractAddress || !minaPrivateKey) {
    throw new Error("unspecified environment variables");
}
const settlementContract = new SettlementContract(PublicKey.fromBase58(settlementContractAddress));
const senderKey = PrivateKey.fromBase58(minaPrivateKey);

await createWorker<ReducerJob, void>({
    queueName: "reduce",
    maxJobsPerWorker: 5,
    jobHandler: async ({ data, id }) => {
        if (!id) {
            throw new Error("Job ID is undefined");
        }

        const { includedActions, signaturePubkeyArray, actions } = data;

        try {
            logger.jobStarted(id, "reduce", {
                actionsCount: actions.length,
                includedActionsCount: includedActions.length,
                signaturesCount: signaturePubkeyArray.length,
                workerId: "reduceWorker",
            });

            const includedActionsMap = toIncludedActionsMap(includedActions);

            await fetchAccount({ publicKey: settlementContract.address });

            const contractState = {
                actionState: settlementContract.actionState.get().toString(),
                merkleListRoot: settlementContract.merkleListRoot.get().toString(),
                stateRoot: settlementContract.stateRoot.get().toString(),
                blockHeight: settlementContract.blockHeight.get().toString(),
                depositListHash: settlementContract.depositListHash.get().toString(),
                withdrawalListHash: settlementContract.withdrawalListHash.get().toString(),
                accountActionState: settlementContract.account.actionState.get().toString(),
            };

            logger.debug("Contract state fetched", {
                jobId: id,
                contractState,
                event: "contract_state_fetched",
            });

            console.table(contractState);

            const packedActions = actions.map((action) => {
                return {
                    action: PulsarAction.fromRawAction(action.actions[0]),
                    hash: BigInt(action.hash),
                };
            });

            const signaturePublicKeyList = SignaturePublicKeyList.fromArray(
                signaturePubkeyArray.map(([signature, publicKey]) => [
                    Signature.fromBase58(signature),
                    PublicKey.fromBase58(publicKey),
                ])
            );

            logger.debug("Preparing batch for included actions", {
                jobId: id,
                includedActionsCount: Object.keys(includedActionsMap).length,
                packedActionsCount: packedActions.length,
                event: "preparing_batch",
            });
            await fetchAccount({ publicKey: settlementContract.address });
            const { batch, useActionStack, publicInput, actionStackProof, mask } =
                await PrepareBatchWithActions(
                    includedActionsMap,
                    settlementContract,
                    packedActions
                );

            logger.debug("Batch prepared, generating validate reduce proof", {
                jobId: id,
                useActionStack: useActionStack.toBoolean(),
                event: "generating_validate_proof",
            });
            const validateReduceProof = await GenerateValidateReduceProof(
                publicInput,
                signaturePublicKeyList
            );

            const tx = await Mina.transaction(
                { sender: senderKey.toPublicKey(), fee },
                async () => {
                    await settlementContract.reduce(
                        batch,
                        useActionStack,
                        actionStackProof,
                        mask,
                        validateReduceProof
                    );
                }
            );

            await tx.prove();
            const pendingTx = await tx.sign([senderKey]).send();
            const txHash = pendingTx.hash;

            await updateActionBatchStatus(actions, "reduced", {
                settlementTxHash: txHash,
            });

            logger.contractInteraction("reduce", txHash, {
                jobId: id,
                actionsCount: actions.length,
                event: "reduce_transaction_sent",
            });

            await pendingTx.wait();

            logger.contractInteraction("reduce_confirmed", txHash, {
                jobId: id,
                actionsCount: actions.length,
                event: "reduce_transaction_confirmed",
            });

            await updateActionBatchStatus(actions, "settled");

            logger.jobCompleted(id, "reduce", 0, {
                actionsCount: actions.length,
                txHash: txHash,
                workerId: "reduceWorker",
            });
        } catch (err: any) {
            logger.jobFailed(id, "reduce", err, {
                actionsCount: actions.length,
                workerId: "reduceWorker",
            });
            await updateActionBatchStatus(actions, "reducing");
            throw err;
        }
    },
});

function toIncludedActionsMap(raw: [string, number][]): Map<string, number> {
    const map = new Map<string, number>();
    for (const [hash, count] of raw) {
        map.set(hash, count);
    }
    return map;
}
