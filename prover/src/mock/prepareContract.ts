import {
    DeployScripts,
    mockValidatorList,
    setMinaNetwork,
    SettlementContract,
} from "pulsar-contracts";
import dotenv from "dotenv";
import { AccountUpdate, fetchAccount, Field, Lightnet, Mina, PrivateKey, UInt64 } from "o1js";
import { cacheCompile } from "../cache.js";
dotenv.config();

if (
    !process.env.MINA_PRIVATE_KEY ||
    !process.env.CONTRACT_PRIVATE_KEY ||
    !process.env.MINA_NETWORK
) {
    throw new Error(
        "Mina private key or contract private key is not set in the environment variables."
    );
}

const signerPrivateKey = PrivateKey.fromBase58(process.env.MINA_PRIVATE_KEY);
const contractPrivateKey = PrivateKey.fromBase58(process.env.CONTRACT_PRIVATE_KEY);
console.log(
    `Signer public key: ${signerPrivateKey
        .toPublicKey()
        .toBase58()}, Contract public key: ${contractPrivateKey.toPublicKey().toBase58()}`
);
setMinaNetwork((process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet") ?? "lightnet");

await cacheCompile("reduce");

const contractInstance = new SettlementContract(contractPrivateKey.toPublicKey());

async function retryUntilSuccess(delayMs = 5000) {
    while (true) {
        try {
            const { privateKey } = await Lightnet.acquireKeyPair({
                isRegularAccount: true,
                lightnetAccountManagerEndpoint: process.env.DOCKER
                    ? "http://mina-local-lightnet:8181"
                    : "http://localhost:8181",
            });

            console.log(`Acquired account: ${privateKey.toPublicKey().toBase58()}`);

            await fetchAccount({ publicKey: privateKey.toPublicKey() });

            const tx = await Mina.transaction(
                { sender: privateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    const senderAccount = AccountUpdate.createSigned(privateKey.toPublicKey());
                    AccountUpdate.fundNewAccount(privateKey.toPublicKey());
                    senderAccount.send({
                        to: signerPrivateKey.toPublicKey(),
                        amount: UInt64.from(1e10),
                    });
                    AccountUpdate.fundNewAccount(privateKey.toPublicKey());
                    await contractInstance.deploy();
                    await contractInstance.initialize(
                        Field.from(
                            6310558633462665370159457076080992493592463962672742685757201873330974620505n
                        )
                    );
                }
            );
            console.log("Waiting for transaction to be processed...");
            await DeployScripts.waitTransactionAndFetchAccount(
                tx,
                [privateKey, contractPrivateKey],
                [contractInstance.address, signerPrivateKey.toPublicKey(), privateKey.toPublicKey()]
            );
            console.log("Deployment successful!");
            break;
        } catch (e) {
            console.error("Deployment failed, retrying in", delayMs / 1000, "seconds");
            console.error(e);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

await retryUntilSuccess();
