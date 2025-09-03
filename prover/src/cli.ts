import inquirer from "inquirer";
import { DeployScripts, setMinaNetwork, SettlementContract } from "pulsar-contracts";
import dotenv from "dotenv";
import { AccountUpdate, fetchAccount, Field, Lightnet, Mina, PrivateKey, UInt64 } from "o1js";
import { cacheCompile } from "./cache.js";
import { PulsarAuth } from "pulsar-contracts/build/src/types/PulsarAction.js";

dotenv.config();

function printHeader() {
    console.clear();
    console.log("\n╭─────────────────────────────────╮");
    console.log("│      Pulsar Actions CLI         │");
    console.log("╰─────────────────────────────────╯\n");
}

function printError(message: string) {
    console.log(`❌ ${message}`);
}

function printSuccess(message: string) {
    console.log(`✅ ${message}`);
}

function createLoadingSpinner(message: string): () => void {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;

    const interval = setInterval(() => {
        process.stdout.write(`\r${frames[i]} ${message}`);
        i = (i + 1) % frames.length;
    }, 80);

    return () => {
        clearInterval(interval);
        process.stdout.write(`\r✅ ${message}\n`);
    };
}

async function validateEnvironment() {
    const stopSpinner = createLoadingSpinner("Validating environment variables...");
    await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate validation time

    if (
        !process.env.MINA_PRIVATE_KEY ||
        !process.env.CONTRACT_PRIVATE_KEY ||
        !process.env.MINA_NETWORK
    ) {
        stopSpinner();
        printError("Missing required environment variables:");
        if (!process.env.MINA_PRIVATE_KEY) console.log("  - MINA_PRIVATE_KEY");
        if (!process.env.CONTRACT_PRIVATE_KEY) console.log("  - CONTRACT_PRIVATE_KEY");
        if (!process.env.MINA_NETWORK) console.log("  - MINA_NETWORK");
        process.exit(1);
    }
    stopSpinner();
}

async function initializeContract() {
    const stopSpinner = createLoadingSpinner("Initializing contract and network...");
    await new Promise((resolve) => setTimeout(resolve, 300));

    const signerPrivateKey = PrivateKey.fromBase58(process.env.MINA_PRIVATE_KEY!);
    const contractPrivateKey = PrivateKey.fromBase58(process.env.CONTRACT_PRIVATE_KEY!);

    if (process.env.DOCKER) {
        setMinaNetwork(process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet");
    } else {
        Mina.setActiveInstance(
            Mina.Network({
                mina: `${process.env.REMOTE_SERVER_URL}:8080/graphql`,
                archive: `${process.env.REMOTE_SERVER_URL}:8282`,
            })
        );
    }

    stopSpinner();

    const { privateKey } = await Lightnet.acquireKeyPair({
        isRegularAccount: true,
        lightnetAccountManagerEndpoint: process.env.DOCKER
            ? "http://mina-local-lightnet:8181"
            : `${process.env.REMOTE_SERVER_URL}:8181`,
    });

    stopSpinner();
    console.log(
        `🔑 Acquired lightnet account: ${privateKey.toPublicKey().toBase58().slice(0, 12)}...`
    );

    const tx = await Mina.transaction({ sender: privateKey.toPublicKey(), fee: 1e9 }, async () => {
        const senderAccount = AccountUpdate.createSigned(privateKey.toPublicKey());
        AccountUpdate.fundNewAccount(privateKey.toPublicKey());
        senderAccount.send({
            to: signerPrivateKey.toPublicKey(),
            amount: UInt64.from(1e10),
        });
        AccountUpdate.fundNewAccount(privateKey.toPublicKey());
    });
    await DeployScripts.waitTransactionAndFetchAccount(
        tx,
        [privateKey],
        [signerPrivateKey.toPublicKey(), privateKey.toPublicKey()]
    );

    console.log(`🔑 Signer: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
    console.log(`📝 Contract: ${contractPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
    console.log(`🌐 Network: ${process.env.MINA_NETWORK}\n`);

    return {
        signerPrivateKey,
        contractPrivateKey,
        contractInstance: new SettlementContract(contractPrivateKey.toPublicKey()),
    };
}

async function performDeposit(
    signerPrivateKey: PrivateKey,
    contractPrivateKey: PrivateKey,
    contractInstance: SettlementContract
) {
    console.log("\n🔄 Starting deposit process...\n");

    const stopSpinner = createLoadingSpinner("Preparing deposit transaction...");

    try {
        if (process.env.MINA_NETWORK === "lightnet") {
            const stopFetchSpinner = createLoadingSpinner("Fetching account information...");
            await fetchAccount({ publicKey: signerPrivateKey.toPublicKey() });
            stopFetchSpinner();

            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    await contractInstance.deposit(
                        UInt64.from(1e9),
                        PulsarAuth.from(Field(0), [Field(0), Field(0)])
                    );
                }
            );
            stopTxSpinner();

            const stopSubmitSpinner = createLoadingSpinner("Submitting transaction to network...");
            await DeployScripts.waitTransactionAndFetchAccount(
                tx,
                [signerPrivateKey, contractPrivateKey],
                [contractInstance.address, signerPrivateKey.toPublicKey()]
            );
            stopSubmitSpinner();

            printSuccess("Deposit completed successfully!");
            console.log(`📍 From: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        } else {
            stopSpinner();
            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    await contractInstance.deposit(
                        UInt64.from(1e9),
                        PulsarAuth.from(Field(0), [Field(0), Field(0)])
                    );
                }
            );
            stopTxSpinner();

            const stopSubmitSpinner = createLoadingSpinner("Submitting transaction to network...");
            await DeployScripts.waitTransactionAndFetchAccount(
                tx,
                [signerPrivateKey, contractPrivateKey],
                [contractInstance.address, signerPrivateKey.toPublicKey()]
            );
            stopSubmitSpinner();

            printSuccess("Deposit completed successfully!");
            console.log(`📍 From: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        }
    } catch (error) {
        stopSpinner();
        printError("Deposit failed!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function performWithdraw(
    signerPrivateKey: PrivateKey,
    contractPrivateKey: PrivateKey,
    contractInstance: SettlementContract
) {
    console.log("\n🔄 Starting withdraw process...\n");

    const stopSpinner = createLoadingSpinner("Preparing withdraw transaction...");

    try {
        if (process.env.MINA_NETWORK === "lightnet") {
            const stopFetchSpinner = createLoadingSpinner("Fetching account information...");
            await fetchAccount({ publicKey: signerPrivateKey.toPublicKey() });
            stopFetchSpinner();

            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    await contractInstance.withdraw(UInt64.from(1e7));
                }
            );
            stopTxSpinner();

            const stopSubmitSpinner = createLoadingSpinner("Submitting transaction to network...");
            await DeployScripts.waitTransactionAndFetchAccount(
                tx,
                [signerPrivateKey, contractPrivateKey],
                [contractInstance.address, signerPrivateKey.toPublicKey()]
            );
            stopSubmitSpinner();

            printSuccess("Withdraw completed successfully!");
            console.log(`📍 To: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        } else {
            stopSpinner();
            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e10 },
                async () => {
                    await contractInstance.withdraw(UInt64.from(1e9));
                }
            );
            stopTxSpinner();

            const stopSubmitSpinner = createLoadingSpinner("Submitting transaction to network...");
            await DeployScripts.waitTransactionAndFetchAccount(
                tx,
                [signerPrivateKey, contractPrivateKey],
                [contractInstance.address, signerPrivateKey.toPublicKey()]
            );
            stopSubmitSpinner();

            printSuccess("Withdraw completed successfully!");
            console.log(`📍 To: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        }
    } catch (error) {
        stopSpinner();
        printError("Withdraw failed!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function showMainMenu(): Promise<"deposit" | "withdraw" | "exit"> {
    console.log("\n");
    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: "🎯 What would you like to do?",
            choices: [
                {
                    name: "💰 Make a Deposit",
                    value: "deposit",
                    short: "Deposit",
                },
                {
                    name: "💸 Make a Withdrawal",
                    value: "withdraw",
                    short: "Withdraw",
                },
                new inquirer.Separator(),
                {
                    name: "🚪 Exit Application",
                    value: "exit",
                    short: "Exit",
                },
            ],
            pageSize: 10,
            loop: false,
        },
    ]);

    return action;
}

async function main() {
    try {
        printHeader();

        await validateEnvironment();
        const { signerPrivateKey, contractPrivateKey, contractInstance } =
            await initializeContract();

        const stopCompileSpinner = createLoadingSpinner(
            "Compiling contracts (this may take a moment)..."
        );
        await cacheCompile("reduce");
        stopCompileSpinner();

        while (true) {
            const action = await showMainMenu();

            if (action === "exit") {
                console.log("\n👋 Thanks for using Pulsar Actions CLI! Goodbye!");
                break;
            }

            try {
                if (action === "deposit") {
                    await performDeposit(signerPrivateKey, contractPrivateKey, contractInstance);
                } else if (action === "withdraw") {
                    await performWithdraw(signerPrivateKey, contractPrivateKey, contractInstance);
                }

                const { continueChoice } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "continueChoice",
                        message: "\n🔄 Would you like to perform another action?",
                        default: true,
                    },
                ]);

                if (!continueChoice) {
                    console.log("\n👋 Thanks for using Pulsar Actions CLI! Goodbye!");
                    break;
                }
            } catch (error) {
                printError("\n💥 Transaction failed!");
                console.log(
                    `📋 Error details: ${error instanceof Error ? error.message : String(error)}\n`
                );

                const { retryChoice } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "retryChoice",
                        message: "❓ What would you like to do next?",
                        choices: [
                            {
                                name: "🔄 Try Again",
                                value: "retry",
                                short: "Retry",
                            },
                            {
                                name: "🏠 Return to Main Menu",
                                value: "menu",
                                short: "Main Menu",
                            },
                            {
                                name: "🚪 Exit Application",
                                value: "exit",
                                short: "Exit",
                            },
                        ],
                    },
                ]);

                if (retryChoice === "exit") {
                    console.log("\n👋 Thanks for using Pulsar Actions CLI! Goodbye!");
                    break;
                } else if (retryChoice === "retry") {
                    if (action === "deposit") {
                        await performDeposit(
                            signerPrivateKey,
                            contractPrivateKey,
                            contractInstance
                        );
                    } else if (action === "withdraw") {
                        await performWithdraw(
                            signerPrivateKey,
                            contractPrivateKey,
                            contractInstance
                        );
                    }
                }
            }
        }
    } catch (error) {
        printError("💥 Fatal error occurred!");
        console.log(`📋 Details: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

main().catch((error) => {
    printError("Unhandled error!");
    console.error(error);
    process.exit(1);
});
