import { Field } from "o1js";
import type { ValidateReduceProof } from "pulsar-contracts";
import type { ActionStackProof } from "pulsar-contracts";
import type { Batch, ReduceMask } from "pulsar-contracts";
import logger from "../../common/logger.js";

export interface ReduceTxParams {
    batch: Batch;
    useActionStack: boolean;
    actionStackProof: ActionStackProof;
    mask: ReduceMask;
    validateReduceProof: ValidateReduceProof;
}

export async function sendReduceTx(params: ReduceTxParams): Promise<void> {
    // contract.reduce(...) buraya gelecek, CONTRACT_ADDRESS + MINA_PRIVATE_KEY kullanılacak
    logger.info("Sending Reduce TX to Mina contract", {
        event: "reduce_tx_sending",
    });

    throw new Error("Not implemented: sendReduceTx");
}
