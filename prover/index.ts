import { Field, Mina, PrivateKey, PublicKey, UInt64 } from "o1js";
import {
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    SettlementContract,
} from "pulsar-contracts";
import axios from "axios";
import express from "express";

let contractAddress: PublicKey = PrivateKey.random().toPublicKey();
let contractInstance: SettlementContract;

let isCompiled = false;

const app = express();
app.use(express.json());

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

async function compile() {
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
}

function setInstance(_contractAddress?: PublicKey) {
    if (_contractAddress) {
        contractAddress = _contractAddress;
    }
    contractInstance = new SettlementContract(contractAddress);
}
