import logger from "../../common/logger.js";
import { MinaActionModel } from "../../db/models/MinaAction.js";
import { BridgeStateModel } from "../../db/models/BridgeState.js";
import { sendBridgeTx } from "../../services/pulsar/txSender.js";
import type { BridgeTxJob } from "./master.js";

export async function worker(task: BridgeTxJob): Promise<void> {
    const { blockHeight, actions } = task;

    const block = await MinaActionModel.findOne({ blockHeight });
    if (!block) {
        throw new Error(`MinaAction for blockHeight ${blockHeight} not found`);
    }

    if (block.status === "done") {
        logger.info("Skipping already done block", {
            blockHeight,
            event: "bridge_tx_already_done",
        });
        return;
    }

    // TODO: compute proof from actions once proof type is decided
    const proof = computeProof(actions);

    await sendBridgeTx({ minaBlockHeight: blockHeight, proof });

    await MinaActionModel.updateOne(
        { blockHeight },
        { $set: { status: "done" } },
    );

    await BridgeStateModel.updateOne(
        {},
        { $set: { lastSubmittedHeight: blockHeight } },
    );

    logger.info("Bridge TX done", {
        blockHeight,
        event: "bridge_tx_done",
    });
}

function computeProof(_actions: object[]): unknown {
    // TODO: implement proof computation once proof type is decided
    return null;
}
