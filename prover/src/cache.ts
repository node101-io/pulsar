import { Cache } from "o1js";
import {
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    SettlementContract,
} from "pulsar-contracts";
import logger from "./logger.js";
import { QueueName } from "./workerConnection.js";

export const cacheCompile = async (mode: QueueName) => {
    try {
        if (mode === "collect-signature") {
            return;
        }
        logger.info("Compiling contracts with cache...");
        const multisigVerifierProgram: Cache = Cache.FileSystem("./cache/multisigVerifierProgram");
        const validateReduceProgram: Cache = Cache.FileSystem("./cache/validateReduceProgram");
        const actionStackProgram: Cache = Cache.FileSystem("./cache/actionStackProgram");
        const settlementContract: Cache = Cache.FileSystem("./cache/settlementContract");

        let time = performance.now();
        await MultisigVerifierProgram.compile({ cache: multisigVerifierProgram });
        logger.performance("MultisigVerifierProgram compilation", performance.now() - time, { mode });
        
        if (mode === "reduce" || mode === "submit") {
            time = performance.now();
            await ValidateReduceProgram.compile({ cache: validateReduceProgram });
            logger.performance("ValidateReduceProgram compilation", performance.now() - time, { mode });
            
            time = performance.now();
            await ActionStackProgram.compile({ cache: actionStackProgram });
            logger.performance("ActionStackProgram compilation", performance.now() - time, { mode });
            
            time = performance.now();
            await SettlementContract.compile({ cache: settlementContract });
            logger.performance("SettlementContract compilation", performance.now() - time, { mode });
        }
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
};
