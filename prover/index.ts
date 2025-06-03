import { Field, Mina, PrivateKey, PublicKey, UInt64 } from "o1js";
import {
    MultisigVerifierProgram,
    ValidateReduceProgram,
    ActionStackProgram,
    SettlementContract,
    GenerateSettlementPublicInput,
    GenerateSettlementProof,
    SignaturePublicKeyList,
    MergeSettlementProofs,
    GenerateValidateReduceProof,
    MapFromArray,
    PrepareBatch,
} from "pulsar-contracts";
import axios from "axios";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

let contractAddress: PublicKey = PrivateKey.random().toPublicKey();
let contractInstance: SettlementContract;
let senderKey: PrivateKey = PrivateKey.fromBase58(process.env.MINA_PRIVATE_KEY!);

const fee = UInt64.from(1e7); // 0.01 MINA

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
    isCompiled = true;
}

function setInstance(_contractAddress?: PublicKey) {
    if (_contractAddress) {
        contractAddress = _contractAddress;
    }
    contractInstance = new SettlementContract(contractAddress);
}

app.post("/create-settlement-proof", async (req, res) => {
    if (!isCompiled) {
        res.status(500).json({ error: "Contracts not compiled yet" });
    }

    const {
        initialMerkleListRoot,
        initialStateRoot,
        initialBlockHeight,
        newMerkleListRoot,
        newStateRoot,
        newBlockHeight,
        proofGeneratorsList,
        signaturePublicKeyArray,
        proofGenerator,
    } = req.body;

    try {
        const publicInput = GenerateSettlementPublicInput(
            Field(initialMerkleListRoot),
            Field(initialStateRoot),
            Field(initialBlockHeight),
            Field(newMerkleListRoot),
            Field(newStateRoot),
            Field(newBlockHeight),
            proofGeneratorsList
        );

        const proof = await GenerateSettlementProof(
            publicInput,
            SignaturePublicKeyList.fromArray(signaturePublicKeyArray),
            PublicKey.fromBase58(proofGenerator)
        );

        res.json({
            publicInput: publicInput.toJSON(),
            proof: proof.toJSON(),
        });
    } catch (error) {
        console.error("Error generating settlement proof:", error);
        res.status(500).json({ error: "Failed to generate settlement proof" });
    }
});

app.post("/merge-settlement-proof", async (req, res) => {
    if (!isCompiled) {
        res.status(500).json({ error: "Contracts not compiled yet" });
    }
    const { settlementProofs } = req.body;

    try {
        const mergedProof = await MergeSettlementProofs(settlementProofs);
        res.json(mergedProof.toJSON());
    } catch (error) {
        console.error("Error merging settlement proofs:", error);
        res.status(500).json({ error: "Failed to merge settlement proofs" });
    }
});

app.post("/reduce", async (req, res) => {
    if (!isCompiled) {
        res.status(500).json({ error: "Contracts not compiled yet" });
    }

    const { includedActions, validateReduceProof } = req.body;
    try {
        const map = MapFromArray(includedActions);

        const { batch, useActionStack, actionStackProof, mask } = await PrepareBatch(
            map,
            contractInstance
        );

        if (actionStackProof === undefined) {
            res.status(400).json({ error: "Action stack proof is undefined" });
            return;
        }

        const tx = await Mina.transaction({ sender: senderKey.toPublicKey(), fee }, async () => {
            await contractInstance.reduce(
                batch,
                useActionStack,
                actionStackProof,
                mask,
                validateReduceProof
            );
        });

        await tx.prove();
        const result = await tx.sign([senderKey]).send();

        res.json({
            transactionHash: result.hash,
        });
    } catch (error) {
        console.error("Error during reduce operation:", error);
        res.status(500).json({ error: "Failed to perform reduce operation" });
    }
});

app.post("/validate-reduce-proof", async (req, res) => {
    if (!isCompiled) {
        res.status(500).json({ error: "Contracts not compiled yet" });
    }

    const { publicInput, signaturePublicKeyList } = req.body;
    try {
        const proof = await GenerateValidateReduceProof(
            publicInput,
            SignaturePublicKeyList.fromArray(signaturePublicKeyList)
        );
        res.json({
            proof: proof.toJSON(),
        });
    } catch (error) {
        console.error("Error generating validate reduce proof:", error);
        res.status(500).json({ error: "Failed to generate validate reduce proof" });
    }
});

app.listen(3131, () => {
    console.log("Server started on port 3131");
});
