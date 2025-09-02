import {
    ActionStackProgram,
    MultisigVerifierProgram,
    SettlementContract,
    ValidateReduceProgram,
} from "pulsar-contracts";
import logger from "./logger.js";
import { QueueName } from "./workerConnection.js";

export { compileContracts, prettierAddress };

async function compileContracts(mode: QueueName) {
    try {
        if (mode === "collect-signature") {
            return;
        }
        logger.info("Compiling contracts...");
        let time = performance.now();
        await MultisigVerifierProgram.compile();
        logger.performance("MultisigVerifierProgram compilation", performance.now() - time, {
            mode,
            event: "contract_compilation"
        });
        if (mode === "reduce") {
            time = performance.now();
            await ValidateReduceProgram.compile();
            logger.performance("ValidateReduceProgram compilation", performance.now() - time, {
                mode,
                event: "contract_compilation"
            });

            time = performance.now();
            await ActionStackProgram.compile();
            logger.performance("ActionStackProgram compilation", performance.now() - time, {
                mode,
                event: "contract_compilation"
            });

            time = performance.now();
            await SettlementContract.compile();
            logger.performance("SettlementContract compilation", performance.now() - time, {
                mode,
                event: "contract_compilation"
            });
        }
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
}

function prettierAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-6)}`;
}
