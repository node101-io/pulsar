import { Mina, PublicKey } from "o1js";
import {
    ActionStackProgram,
    MultisigVerifierProgram,
    SettlementContract,
    ValidateReduceProgram,
} from "pulsar-contracts";

export {
    compileContracts,
    setMinaNetwork,
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

function setMinaNetwork(network: "devnet" | "mainnet" = "devnet") {
    const Devnet = Mina.Network({
        mina: "https://api.minascan.io/node/devnet/v1/graphql",
        archive: "https://api.minascan.io/archive/devnet/v1/graphql",
    });

    const Mainnet = Mina.Network({
        mina: "https://api.minascan.io/node/mainnet/v1/graphql",
        archive: "https://api.minascan.io/archive/mainnet/v1/graphql",
    });

    if (network === "devnet") {
        Mina.setActiveInstance(Devnet);
    }
    if (network === "mainnet") {
        Mina.setActiveInstance(Mainnet);
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
