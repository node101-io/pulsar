import {
    ActionStackProgram,
    MultisigVerifierProgram,
    SettlementContract,
    ValidateReduceProgram,
} from "pulsar-contracts";

export {
    compileContracts,
    prettierAddress,
    collectReduceSignatures,
    collectBlockSignatures,
    createValidateReduceProof,
};

async function compileContracts() {
    try {
        let time = performance.now();
        await MultisigVerifierProgram.compile();
        console.log(`MultisigVerifierProgram compiled in ${performance.now() - time} ms`);
        time = performance.now();

        await ValidateReduceProgram.compile();
        console.log(`ValidateReduceProgram compiled in ${performance.now() - time} ms`);

        time = performance.now();
        await ActionStackProgram.compile();
        console.log(`ActionStackProgram compiled in ${performance.now() - time} ms`);

        time = performance.now();
        await SettlementContract.compile();
        console.log(`SettlementContract compiled in ${performance.now() - time} ms`);
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
}

function prettierAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-6)}`;
}

async function fetchPulsarBlockHeight(): Promise<number> {
    return Math.random() * 1000000;
}

async function collectReduceSignatures() {}

async function collectBlockSignatures() {}

async function createValidateReduceProof() {}
