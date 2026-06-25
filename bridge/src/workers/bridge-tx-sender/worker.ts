// o1js
import { Bool, Field, Poseidon } from "o1js";

// contracts
import { ActionStackProof } from "../../../../contracts/build/src/ActionStack.js";
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
import { CalculateFinalActionState } from "../../../../contracts/build/src/utils/actionQueueUtils.js";
import {
    GenerateValidateReduceProof,
    GenerateActionStackProof,
} from "../../../../contracts/build/src/utils/generateFunctions.js";
import {
    BATCH_SIZE,
    VALIDATOR_NUMBER,
} from "../../../../contracts/build/src/utils/constants.js";

// bridge
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
import {
    proveReduceTx,
    sendProvedReduceTx,
} from "../../services/mina/txSender.js";
import type { BridgeTxJob } from "./master.js";

interface ChunkParams {
    ctx: MinaClientContext;
    chunk: PulsarAction[];
    remainingActions: PulsarAction[];
    actionsFromChunk: PulsarAction[];
    blockHeight: number;
    chunkIndex: number;
    chunkCount: number;
}

interface ReduceTxParams {
    ctx: MinaClientContext;
    batch: Batch;
    mask: ReduceMask;
    merkleListRoot: Field;
    actionListHash: Field;
    initialActionState: Field;
    finalActionState: Field;
    useActionStack: Bool;
    actionStackProof: ActionStackProof;
    blockHeight: number;
    logMeta: object;
}

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
    await refreshContractState(ctx);

    const pulsarActions = (actions as string[][]).map((raw) =>
        PulsarAction.fromRawAction(raw),
    );

    logger.info("Actions parsed", {
        blockHeight,
        actionCount: pulsarActions.length,
        event: "actions_prepared",
    });

    if (pulsarActions.length <= BATCH_SIZE) {
        await proveSingleBatch(ctx, pulsarActions, blockHeight);
    } else {
        const chunks = chunkArray(pulsarActions, BATCH_SIZE);
        for (let i = 0; i < chunks.length; i++) {
            await processChunk({
                ctx,
                chunk: chunks[i],
                remainingActions: pulsarActions.slice((i + 1) * BATCH_SIZE),
                actionsFromChunk: pulsarActions.slice(i * BATCH_SIZE),
                blockHeight,
                chunkIndex: i,
                chunkCount: chunks.length,
            });
            if (i < chunks.length - 1) {
                await refreshContractState(ctx);
            }
        }
    }

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

async function proveSingleBatch(
    ctx: MinaClientContext,
    pulsarActions: PulsarAction[],
    blockHeight: number,
): Promise<void> {
    const initialActionState = Field(getContractActionState(ctx));
    const initialActionListHash = Field(getContractActionListHash(ctx));
    const merkleListRoot = Field(getContractMerkleRoot(ctx));

    const finalActionState = CalculateFinalActionState(
        initialActionState,
        pulsarActions,
    );
    const { batch, mask } = buildBatchAndMask(pulsarActions);
    const actionListHash = computeActionListHash(
        initialActionListHash,
        batch,
        mask,
    );
    const actionStackProof = await ActionStackProof.dummy(
        Field(0),
        Field(0),
        0,
        16,
    );

    const reduceTxParams: ReduceTxParams = {
        ctx: ctx,
        batch: batch,
        mask: mask,
        merkleListRoot: merkleListRoot,
        actionListHash: actionListHash,
        initialActionState: initialActionState,
        finalActionState: finalActionState,
        useActionStack: Bool(false),
        actionStackProof: actionStackProof,
        blockHeight: blockHeight,
        logMeta: {},
    };

    await proveAndSendReduceTx(reduceTxParams);
}

async function processChunk({
    ctx,
    chunk,
    remainingActions,
    actionsFromChunk,
    blockHeight,
    chunkIndex,
    chunkCount,
}: ChunkParams): Promise<void> {
    const initialActionState = Field(getContractActionState(ctx));
    const initialActionListHash = Field(getContractActionListHash(ctx));
    const merkleListRoot = Field(getContractMerkleRoot(ctx));

    const batchActionState = CalculateFinalActionState(
        initialActionState,
        chunk,
    );
    const chunkFinalActionState = CalculateFinalActionState(
        initialActionState,
        actionsFromChunk,
    );

    const { batch, mask } = buildBatchAndMask(chunk);
    const actionListHash = computeActionListHash(
        initialActionListHash,
        batch,
        mask,
    );

    const { useActionStack, actionStackProof } = await GenerateActionStackProof(
        batchActionState,
        remainingActions,
    );

    const reduceTxParams: ReduceTxParams = {
        ctx: ctx,
        batch: batch,
        mask: mask,
        merkleListRoot: merkleListRoot,
        actionListHash: actionListHash,
        initialActionState: initialActionState,
        finalActionState: chunkFinalActionState,
        useActionStack: useActionStack,
        actionStackProof: actionStackProof,
        blockHeight: blockHeight,
        logMeta: { chunkIndex, chunkCount },
    };

    await proveAndSendReduceTx(reduceTxParams);
}

async function proveAndSendReduceTx({
    ctx,
    batch,
    mask,
    merkleListRoot,
    actionListHash,
    initialActionState,
    finalActionState,
    useActionStack,
    actionStackProof,
    blockHeight,
    logMeta,
}: ReduceTxParams): Promise<void> {
    const signatures = await requestSignatures(
        initialActionState.toString(),
        finalActionState.toString(),
    );

    logger.info("Validator signatures received", {
        blockHeight,
        ...logMeta,
        sigCount: signatures.length,
        event: "signatures_received",
    });

    const validateReduceProof = await GenerateValidateReduceProof(
        new ValidateReducePublicInput({ merkleListRoot, actionListHash }),
        buildSignatureList(signatures),
    );

    logger.info("Proofs generated", {
        blockHeight,
        ...logMeta,
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
        logger.info("Reduce TX already on-chain", {
            blockHeight,
            ...logMeta,
            event: "reduce_tx_already_onchain",
        });
        return;
    }

    await sendProvedReduceTx(ctx, provedTxJson, blockHeight);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export function computeActionListHash(
    startHash: Field,
    batch: Batch,
    mask: ReduceMask,
): Field {
    let hash = startHash;
    for (let i = 0; i < BATCH_SIZE; i++) {
        const action = batch.actions[i];
        if (PulsarAction.isDummy(action).toBoolean()) continue;
        if (!mask.list[i].toBoolean()) continue;
        hash = Poseidon.hash([
            hash,
            action.type,
            ...action.account.toFields(),
            action.amount,
            ...action.pulsarAuth.toFields(),
        ]);
    }
    return hash;
}

// TODO: will be done when pulsar module is completed
export function buildSignatureList(
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
): SignaturePublicKeyList {
    const padded = signatures.slice(0, VALIDATOR_NUMBER);
    while (padded.length < VALIDATOR_NUMBER) {
        padded.push({
            validatorPublicKey: null as any,
            signature: null as any,
        });
    }
    return new SignaturePublicKeyList({
        list: padded.map(
            (s) =>
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
        throw new Error(
            `chunk exceeds BATCH_SIZE (${pulsarActions.length} > ${BATCH_SIZE}) — use chunkArray before calling`,
        );
    }
    const batch = Batch.fromArray(pulsarActions);
    const maskBools = [
        ...Array(pulsarActions.length).fill(true),
        ...Array(BATCH_SIZE - pulsarActions.length).fill(false),
    ];
    return { batch, mask: ReduceMask.fromArray(maskBools) };
}
