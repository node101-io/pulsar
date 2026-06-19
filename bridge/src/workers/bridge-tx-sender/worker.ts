import { Field, Poseidon } from "o1js";
import {
    GenerateValidateReduceProof,
    GenerateActionStackProof,
} from "../../../../contracts/build/src/utils/generateFunctions.js";
import { ValidateReducePublicInput } from "../../../../contracts/build/src/ValidateReduce.js";
import {
    PulsarAction,
    Batch,
} from "../../../../contracts/build/src/types/PulsarAction.js";
import { ReduceMask } from "../../../../contracts/build/src/types/common.js";
import {
    SignaturePublicKey,
    SignaturePublicKeyList,
} from "../../../../contracts/build/src/types/signaturePubKeyList.js";
import {
    CalculateFinalActionState,
} from "../../../../contracts/build/src/utils/actionQueueUtils.js";
import { BATCH_SIZE, VALIDATOR_NUMBER } from "../../../../contracts/build/src/utils/constants.js";
import { MAX_FAIL_COUNT } from "../../config/constants.js";
import logger from "../../common/logger.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import { BridgeStateModel } from "../../db/models/BridgeState.js";
import {
    type MinaClientContext,
    initMinaClientContext,
    refreshContractState,
    getContractMerkleRoot,
    getContractActionState,
    getContractActionListHash,
} from "../../services/mina/client.js";
import { requestSignatures } from "../../services/pulsar/client.js";
import { proveReduceTx, sendProvedReduceTx } from "../../services/mina/txSender.js";
import type { BridgeTxJob } from "./master.js";

// context lazily initialized once per worker process
let _ctx: MinaClientContext | null = null;
async function getCtx(): Promise<MinaClientContext> {
    if (!_ctx) _ctx = await initMinaClientContext();
    return _ctx;
}

export async function worker(task: BridgeTxJob): Promise<void> {
    const { blockHeight, actions } = task;

    const block = await MinaActionModel.findOne({ blockHeight });
    if (!block)
        throw new Error(`MinaAction for blockHeight ${blockHeight} not found`);

    if (block.status === "done") {
        logger.info("Skipping already done block", {
            blockHeight,
            event: "bridge_tx_already_done",
        });
        return;
    }

    if (block.failCount >= MAX_FAIL_COUNT) {
        logger.error("Block exceeded max fail count, dropping job", {
            blockHeight,
            failCount: block.failCount,
            event: "bridge_tx_max_fail_exceeded",
        });
        return;
    }

    const ctx = await getCtx();

    // Always fetch fresh on-chain state before constructing the proof inputs.
    await refreshContractState(ctx);

    const merkleListRoot = Field(getContractMerkleRoot(ctx));
    const initialActionState = Field(getContractActionState(ctx));
    const initialActionListHash = Field(getContractActionListHash(ctx));

    // convert raw field arrays from archive into typed PulsarAction structs
    const rawActions = actions as string[][];
    const pulsarActions = rawActions.map((raw) => PulsarAction.fromRawAction(raw));
    const finalActionState = CalculateFinalActionState(initialActionState, pulsarActions);

    logger.info("Actions parsed", {
        blockHeight,
        actionCount: pulsarActions.length,
        event: "actions_prepared",
    });

    const { batch, mask } = buildBatchAndMask(pulsarActions);

    // mirror the contract's reduce loop off-circuit to compute the proof public input
    const actionListHash = computeActionListHash(initialActionListHash, batch, mask);
    const publicInput = new ValidateReducePublicInput({ merkleListRoot, actionListHash });

    const signatures = await requestSignatures(
        initialActionState.toString(),
        finalActionState.toString(),
    );

    logger.info("Validator signatures received", {
        blockHeight,
        sigCount: signatures.length,
        event: "signatures_received",
    });

    const validateReduceProof = await GenerateValidateReduceProof(
        publicInput,
        buildSignatureList(signatures),
    );

    const { useActionStack, actionStackProof } = await GenerateActionStackProof(
        finalActionState,
        pulsarActions,
    );

    logger.info("Proofs generated", {
        blockHeight,
        useActionStack: useActionStack.toBoolean(),
        event: "proofs_generated",
    });

    const provedTxJson = await proveReduceTx({
        ctx,
        batch,
        useActionStack,
        actionStackProof,
        mask,
        validateReduceProof,
        upToMinaHeight: blockHeight,
    });

    if (provedTxJson === null) {
        // Already processed on-chain — mark done and exit.
        await MinaActionModel.updateOne(
            { blockHeight },
            { $set: { status: "done" } },
        );
        await BridgeStateModel.updateOne(
            {},
            { $set: { lastSubmittedHeight: blockHeight } },
        );
        logger.info("Reduce TX already on-chain, marked done", {
            blockHeight,
            event: "reduce_tx_already_onchain",
        });
        return;
    }

    await sendProvedReduceTx(ctx, provedTxJson, blockHeight);

    await MinaActionModel.updateOne(
        { blockHeight },
        { $set: { status: "done" } },
    );
    await BridgeStateModel.updateOne(
        {},
        { $set: { lastSubmittedHeight: blockHeight } },
    );

    logger.info("Reduce TX done", { blockHeight, event: "reduce_tx_done" });
}

export function computeActionListHash(startHash: Field, batch: Batch, mask: ReduceMask): Field {
    let hash = startHash;
    for (let i = 0; i < BATCH_SIZE; i++) {
        const action = batch.actions[i];
        if (PulsarAction.isDummy(action).toBoolean()) continue;
        if (!mask.list[i].toBoolean()) continue;
        hash = Poseidon.hash([hash, action.type, ...action.account.toFields(), action.amount, ...action.pulsarAuth.toFields()]);
    }
    return hash;
}

export function buildSignatureList(
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
): SignaturePublicKeyList {
    // pad to VALIDATOR_NUMBER slots; unused slots get null-filled entries
    const padded = signatures.slice(0, VALIDATOR_NUMBER);
    while (padded.length < VALIDATOR_NUMBER) {
        padded.push({ validatorPublicKey: null as any, signature: null as any });
    }

    return new SignaturePublicKeyList({
        list: padded.map((s) =>
            new SignaturePublicKey({
                publicKey: s.validatorPublicKey,
                signature: s.signature,
            }),
        ),
    });
}

export function buildBatchAndMask(pulsarActions: PulsarAction[]): {
    batch: Batch;
    mask: ReduceMask;
} {
    if (pulsarActions.length > BATCH_SIZE) {
        throw new Error(`Too many actions for one batch: ${pulsarActions.length} > ${BATCH_SIZE}`);
    }

    const batch = Batch.fromArray(pulsarActions);
    const maskBools = [
        ...Array(pulsarActions.length).fill(true),
        ...Array(BATCH_SIZE - pulsarActions.length).fill(false),
    ];
    const mask = ReduceMask.fromArray(maskBools);

    return { batch, mask };
}
