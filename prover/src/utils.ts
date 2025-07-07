import {
    ActionStackProgram,
    MultisigVerifierProgram,
    SettlementContract,
    ValidateReduceProgram,
} from "pulsar-contracts";
import logger from "./logger.js";

export { compileContracts, prettierAddress };

async function compileContracts(mode: "settlement" | "reducer") {
    try {
        logger.info("Compiling contracts...");
        let time = performance.now();
        await MultisigVerifierProgram.compile();
        console.log(`MultisigVerifierProgram compiled in ${performance.now() - time} ms`);
        if (mode === "reducer") {
            time = performance.now();
            await ValidateReduceProgram.compile();
            console.log(`ValidateReduceProgram compiled in ${performance.now() - time} ms`);

            time = performance.now();
            await ActionStackProgram.compile();
            console.log(`ActionStackProgram compiled in ${performance.now() - time} ms`);

            time = performance.now();
            await SettlementContract.compile();
            console.log(`SettlementContract compiled in ${performance.now() - time} ms`);
        }
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
}

function prettierAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-6)}`;
}
