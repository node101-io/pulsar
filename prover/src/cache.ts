import { Cache } from "o1js";
import {
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    SettlementContract,
} from "pulsar-contracts";
import logger from "./logger.js";

export const cacheCompile = async (mode: "settlement" | "reducer") => {
    try {
        logger.info("Compiling contracts with cache...");
        const multisigVerifierProgram: Cache = Cache.FileSystem("./cache/multisigVerifierProgram");
        const validateReduceProgram: Cache = Cache.FileSystem("./cache/validateReduceProgram");
        const actionStackProgram: Cache = Cache.FileSystem("./cache/actionStackProgram");
        const settlementContract: Cache = Cache.FileSystem("./cache/settlementContract");

        let time = performance.now();
        await MultisigVerifierProgram.compile({ cache: multisigVerifierProgram });
        console.log(`MultisigVerifierProgram compiled in ${performance.now() - time} ms`);
        if (mode === "reducer") {
            time = performance.now();
            await ValidateReduceProgram.compile({ cache: validateReduceProgram });
            console.log(`ValidateReduceProgram compiled in ${performance.now() - time} ms`);
            time = performance.now();
            await ActionStackProgram.compile({ cache: actionStackProgram });
            console.log(`ActionStackProgram compiled in ${performance.now() - time} ms`);
            time = performance.now();
            await SettlementContract.compile({ cache: settlementContract });
            console.log(`SettlementContract compiled in ${performance.now() - time} ms`);
        }
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
};
