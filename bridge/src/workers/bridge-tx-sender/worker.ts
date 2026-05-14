import { Field, Poseidon } from "o1js";
import {
    validateActionList,
    GenerateValidateReduceProof,
    GenerateActionStackProof,
    ValidateReducePublicInput,
    SignaturePublicKeyList,
    Batch,
    ReduceMask,
    PulsarAction,
    BATCH_SIZE,
    emptyActionListHash,
} from "pulsar-contracts";
import type { ValidateReduceProof } from "pulsar-contracts";
import logger from "../../common/logger.js";
import type { PulsarActionData } from "../../common/types.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import { BridgeStateModel } from "../../db/models/BridgeState.js";
import {
    getContractMerkleRoot,
    getContractActionState,
} from "../../services/mina/client.js";
import { requestSignatures } from "../../services/pulsar/client.js";
import { sendReduceTx } from "../../services/mina/txSender.js";
import type { BridgeTxJob } from "./master.js";

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

    const merkleListRoot = Field(await getContractMerkleRoot());
    const initialActionState = Field(await getContractActionState());

    const { actions: pulsarActions, finalActionState } = validateActionList(
        initialActionState,
        actions as PulsarActionData[],
    );

    logger.info("Action list prepared", {
        blockHeight,
        actionCount: pulsarActions.length,
        event: "actions_prepared",
    });

    const { batch, mask } = buildBatchAndMask(pulsarActions);

    const actionListHash = computeActionListHash(batch, mask);
    const publicInput = new ValidateReducePublicInput({ merkleListRoot, actionListHash });

    const signatures = await requestSignatures(blockHeight);

    logger.info("Validator signatures received", {
        blockHeight,
        sigCount: signatures.length,
        event: "signatures_received",
    });

    const validateReduceProof: ValidateReduceProof = await GenerateValidateReduceProof(
        publicInput,
        buildSignatureList(signatures),
    );

    const { useActionStack, actionStackProof } = await GenerateActionStackProof(
        Field(finalActionState),
        pulsarActions.map((a) => a.action),
    );

    logger.info("Proofs generated", {
        blockHeight,
        useActionStack: useActionStack.toBoolean(),
        event: "proofs_generated",
    });

    await sendReduceTx({
        batch,
        useActionStack,
        actionStackProof,
        mask,
        validateReduceProof,
    });

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

// kontratın reduce loop'unu taklit ediyor, SettlementContract.reduce ile birebir aynı olmalı
function computeActionListHash(batch: Batch, mask: ReduceMask): Field {
    let hash = emptyActionListHash;
    for (let i = 0; i < BATCH_SIZE; i++) {
        const action = batch.actions[i];
        if (PulsarAction.isDummy(action).toBoolean()) continue;
        if (!mask.list[i].toBoolean()) continue;
        hash = Poseidon.hash([hash, ...action.toFields()]);
    }
    return hash;
}

function buildSignatureList(
    _signatures: Awaited<ReturnType<typeof requestSignatures>>,
): SignaturePublicKeyList {
    throw new Error("Not implemented: buildSignatureList");
}

function buildBatchAndMask(_pulsarActions: any[]): {
    batch: Batch;
    mask: ReduceMask;
} {
    throw new Error("Not implemented: buildBatchAndMask");
}
