// o1js
import { Bool, Field, Poseidon, PublicKey, Signature } from "o1js";

// contracts
import { ActionStackProof } from "pulsar-contracts/build/src/ActionStack.js";
import { ValidateReducePublicInput } from "pulsar-contracts/build/src/ValidateReduce.js";
import {
    PulsarAction,
    Batch,
} from "pulsar-contracts/build/src/types/PulsarAction.js";
import { ReduceMask } from "pulsar-contracts/build/src/types/common.js";
import {
    SignaturePublicKey,
    SignaturePublicKeyList,
} from "pulsar-contracts/build/src/types/signaturePubKeyList.js";
import { CalculateFinalActionState } from "pulsar-contracts/build/src/utils/actionQueueUtils.js";
import {
    GenerateValidateReduceProof,
    GenerateActionStackProof,
} from "pulsar-contracts/build/src/utils/generateFunctions.js";
import {
    BATCH_SIZE,
    VALIDATOR_NUMBER,
} from "pulsar-contracts/build/src/utils/constants.js";

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
    getContractSettledHeight,
} from "../../services/mina/client.js";
import { requestSignatures } from "../../services/pulsar/client.js";
import {
    type OrderedValidator,
    resolveValidatorSetForRoot,
} from "../../services/pulsar/validatorSet.js";
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

    // The circuit rebuilds the validator MerkleList from ALL slots and asserts
    // it equals merkleListRoot, so the signature list must carry the full
    // ordered set (with powers) — not just the validators that signed.
    // Height comes from the SAME cached snapshot as merkleListRoot: a fresh
    // fetch could observe a newer settlement than the cached root.
    const validatorSet = await resolveValidatorSetForRoot(
        merkleListRoot.toString(),
        getContractSettledHeight(ctx),
    );

    // Fail fast with a clear error when quorum is impossible even if every
    // received signature verifies — proving would only fail in-circuit after
    // minutes of wasted work ("Not enough signed voting power").
    assertPossibleQuorum(validatorSet, signatures, { blockHeight, ...logMeta });

    const validateReduceProof = await GenerateValidateReduceProof(
        new ValidateReducePublicInput({ merkleListRoot, actionListHash }),
        buildSignatureList(validatorSet, signatures),
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

/**
 * Optimistic 2/3 voting-power pre-check: counts every RECEIVED signature as
 * valid (the circuit is the real enforcer). If even that upper bound misses
 * quorum, GenerateValidateReduceProof is guaranteed to fail in-circuit —
 * throw the clear error up front instead.
 */
export function assertPossibleQuorum(
    validators: OrderedValidator[],
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
    logMeta: object = {},
): void {
    const signerKeys = new Set(
        signatures.map((s) => s.validatorPublicKey.toBase58()),
    );

    let signedPower = 0n;
    let totalPower = 0n;
    for (const v of validators) {
        const power = BigInt(v.power);
        totalPower += power;
        if (signerKeys.has(v.minaPublicKey)) signedPower += power;
    }

    if (signedPower * 3n < totalPower * 2n) {
        logger.error("Signed voting power below 2/3 quorum", {
            ...logMeta,
            signedPower: signedPower.toString(),
            totalPower: totalPower.toString(),
            sigCount: signatures.length,
            event: "quorum_not_reached",
        });
        throw new Error(
            `Signed voting power ${signedPower}/${totalPower} is below the ` +
                `2/3 quorum even if every received signature is valid`,
        );
    }
}

export function buildSignatureList(
    validators: OrderedValidator[],
    signatures: Awaited<ReturnType<typeof requestSignatures>>,
): SignaturePublicKeyList {
    if (validators.length !== VALIDATOR_NUMBER) {
        throw new Error(
            `validator set size ${validators.length} != VALIDATOR_NUMBER ` +
                `${VALIDATOR_NUMBER} — the circuit sizes its leaf list to it`,
        );
    }

    const sigByKey = new Map(
        signatures.map((s) => [s.validatorPublicKey.toBase58(), s.signature]),
    );

    // Every validator keeps its (publicKey, power) leaf in the chain's fold
    // order. A non-signer gets the well-formed dummy signature (r=1, s=1):
    // it fails signature.verify in the circuit (excluded from accumulated
    // power) while its leaf + power still reproduce the root and the totals.
    return new SignaturePublicKeyList({
        list: validators.map(
            (v) =>
                new SignaturePublicKey({
                    publicKey: PublicKey.fromBase58(v.minaPublicKey),
                    signature:
                        sigByKey.get(v.minaPublicKey) ??
                        Signature.fromValue({ r: 1n, s: 1n }),
                    power: Field(v.power),
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
