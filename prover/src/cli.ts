import inquirer from "inquirer";
import { DeployScripts, PulsarEncoder, setMinaNetwork, SettlementContract } from "pulsar-contracts";
import dotenv from "dotenv";
import { AccountUpdate, fetchAccount, Field, Lightnet, Mina, PrivateKey, PublicKey, UInt64 } from "o1js";
import { cacheCompile } from "./cache.js";
import { CosmosSignature, PulsarAuth, logZkappState } from "pulsar-contracts";
import { prettierAddress } from "./utils.js";
import fs from "fs";

dotenv.config();

const signerPrivateKey = PrivateKey.fromBigInt(
    PulsarEncoder.hexToBigint(process.env.MINA_PRIVATE_KEY_HEX!)
);
const contractPrivateKey = PrivateKey.fromBase58(process.env.CONTRACT_PRIVATE_KEY!);
const contractInstance = new SettlementContract(contractPrivateKey.toPublicKey());

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
        !process.env.MINA_PRIVATE_KEY_HEX ||
        !process.env.CONTRACT_PRIVATE_KEY ||
        !process.env.MINA_NETWORK
    ) {
        stopSpinner();
        printError("Missing required environment variables:");
        if (!process.env.MINA_PRIVATE_KEY_HEX) console.log("  - MINA_PRIVATE_KEY_HEX");
        if (!process.env.CONTRACT_PRIVATE_KEY) console.log("  - CONTRACT_PRIVATE_KEY");
        if (!process.env.MINA_NETWORK) console.log("  - MINA_NETWORK");
        process.exit(1);
    }
    stopSpinner();
}

function setNetwork() {
    const stopSpinner = createLoadingSpinner("Initializing contract and network...");

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
}

async function initializeSigner() {
    const stopSpinner = createLoadingSpinner("Initializing signer account...");

    const { account, error } = await fetchAccount({
        publicKey: signerPrivateKey.toPublicKey(),
    });

    if (
        account &&
        Mina.getAccount(signerPrivateKey.toPublicKey())
            .balance.greaterThan(UInt64.from(0))
            .toBoolean()
    ) {
        stopSpinner();
        console.log("Signer account balance is sufficient.");
        return;
    }

    const { privateKey } = await Lightnet.acquireKeyPair({
        isRegularAccount: true,
        lightnetAccountManagerEndpoint: process.env.DOCKER
            ? "http://mina-local-lightnet:8181"
            : `${process.env.REMOTE_SERVER_URL}:8181`,
    });

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
    });
    await DeployScripts.waitTransactionAndFetchAccount(
        tx,
        [privateKey],
        [signerPrivateKey.toPublicKey(), privateKey.toPublicKey()]
    );

    console.log(`🔑 Signer: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
    console.log(`📝 Contract: ${contractPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
    console.log(`🌐 Network: ${process.env.MINA_NETWORK}\n`);
    stopSpinner();
}

async function performDeposit(
    signerPrivateKey: PrivateKey,
    contractPrivateKey: PrivateKey,
    contractInstance: SettlementContract
) {
    console.log("\n🔄 Starting deposit process...\n");

    const { depositAmount } = await inquirer.prompt([
        {
            type: "input",
            name: "depositAmount",
            message: "💰 Enter deposit amount (e.g., 0.1234, 5.678):",
            default: "1.0",
            validate: (input) => {
                const num = parseFloat(input);
                if (isNaN(num) || num <= 0)
                    return "Amount must be a positive number (e.g., 0.1234, 5.678)";
                return true;
            },
        },
    ]);

    const stopSpinner = createLoadingSpinner("Preparing deposit transaction...");

    try {
        if (process.env.MINA_NETWORK === "lightnet") {
            stopSpinner();
            const stopFetchSpinner = createLoadingSpinner("Fetching account information...");
            await fetchAccount({ publicKey: signerPrivateKey.toPublicKey() });
            stopFetchSpinner();

            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    await contractInstance.deposit(
                        UInt64.from(parseFloat(depositAmount) * 1e9),
                        PulsarAuth.from(Field(0), CosmosSignature.empty())
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
            console.log(`From: ${prettierAddress(signerPrivateKey.toPublicKey().toBase58())}...`);
        } else {
            stopSpinner();
            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    await contractInstance.deposit(
                        UInt64.from(parseFloat(depositAmount)),
                        PulsarAuth.from(Field(0), CosmosSignature.empty())
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
            console.log(`From: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
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

    const { withdrawAmount } = await inquirer.prompt([
        {
            type: "input",
            name: "withdrawAmount",
            message: "💸 Enter withdraw amount (e.g., 0.1234, 5.678):",
            default: "1.0",
            validate: (input) => {
                const num = parseFloat(input);
                if (isNaN(num) || num <= 0)
                    return "Amount must be a positive number (e.g., 0.1234, 5.678)";
                return true;
            },
        },
    ]);

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
                    await contractInstance.withdraw(UInt64.from(parseFloat(withdrawAmount) * 1e9));
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
            console.log(`To: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        } else {
            stopSpinner();
            const stopTxSpinner = createLoadingSpinner("Building transaction...");
            const tx = await Mina.transaction(
                { sender: signerPrivateKey.toPublicKey(), fee: 1e10 },
                async () => {
                    await contractInstance.withdraw(UInt64.from(parseFloat(withdrawAmount)));
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
            console.log(`To: ${signerPrivateKey.toPublicKey().toBase58().slice(0, 12)}...`);
        }
    } catch (error) {
        stopSpinner();
        printError("Withdraw failed!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function performFaucetToAddress() {
    console.log("\n🪙 Faucet to address (Lightnet only) ...\n");

    if (process.env.MINA_NETWORK !== "lightnet") {
        printError("Faucet is only available on MINA_NETWORK=lightnet");
        return;
    }

    const { recipient, faucetAmount } = await inquirer.prompt([
        {
            type: "input",
            name: "recipient",
            message: "📬 Enter recipient B62 address:",
            validate: (input) => {
                try {
                    PublicKey.fromBase58(input);
                    return true;
                } catch (e) {
                    return "Enter a valid B62 Mina address";
                }
            },
        },
        {
            type: "input",
            name: "faucetAmount",
            message: "💧 Enter amount to send (e.g., 1.0, 5.5):",
            default: "5.0",
            validate: (input) => {
                const num = parseFloat(input);
                if (isNaN(num) || num <= 0) return "Amount must be a positive number";
                return true;
            },
        },
    ]);

    const stopSpinner = createLoadingSpinner("Preparing faucet transfer...");

    try {
        const recipientPk = PublicKey.fromBase58(recipient);

        const { privateKey } = await Lightnet.acquireKeyPair({
            isRegularAccount: true,
            lightnetAccountManagerEndpoint: process.env.DOCKER
                ? "http://mina-local-lightnet:8181"
                : `${process.env.REMOTE_SERVER_URL}:8181`,
        });

        stopSpinner();
        const stopTxSpinner = createLoadingSpinner("Building transaction...");
        // Check if recipient account exists to conditionally pay account creation fee
        const { account: recipientAccount } = await fetchAccount({ publicKey: recipientPk });
        const tx = await Mina.transaction(
            { sender: privateKey.toPublicKey(), fee: 1e9 },
            async () => {
                const senderAccount = AccountUpdate.createSigned(privateKey.toPublicKey());
                if (!recipientAccount) {
                    AccountUpdate.fundNewAccount(privateKey.toPublicKey());
                }
                senderAccount.send({
                    to: recipientPk,
                    amount: UInt64.from(parseFloat(faucetAmount) * 1e9),
                });
            }
        );
        stopTxSpinner();

        const stopSubmitSpinner = createLoadingSpinner("Submitting transaction to network...");
        await DeployScripts.waitTransactionAndFetchAccount(tx, [privateKey], [recipientPk, privateKey.toPublicKey()]);
        stopSubmitSpinner();

        printSuccess("Faucet transfer completed successfully!");
        console.log(`To: ${prettierAddress(recipientPk.toBase58())}...`);
    } catch (error) {
        stopSpinner();
        printError("Faucet transfer failed!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function performWarmUpCache() {
    console.log("\n🔥 Starting cache warm-up process...\n");

    const stopSpinner = createLoadingSpinner("Warming up cache for all contracts...");

    try {
        fs.rmSync("../../cache", { recursive: true, force: true });

        for (let i = 0; i < 5; i++) {
            await cacheCompile("reduce");
        }
        stopSpinner();
        printSuccess("Cache warm-up completed successfully!");
        console.log("📦 All contracts have been compiled and cached for faster execution");
    } catch (error) {
        stopSpinner();
        printError("Cache warm-up failed!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function performLogContractState(contractInstance: SettlementContract) {
    console.log("\n📊 Fetching contract state...\n");

    const stopSpinner = createLoadingSpinner("Fetching contract account information...");

    try {
        await fetchAccount({ publicKey: contractInstance.address });
        stopSpinner();

        console.log("\n📋 Contract State Information:");
        console.log("─".repeat(50));
        logZkappState("Current Contract State", contractInstance);
        console.log("─".repeat(50));

        printSuccess("Contract state logged successfully!");
    } catch (error) {
        stopSpinner();
        printError("Failed to fetch contract state!");
        console.log(`Details: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function showMainMenu(): Promise<"deposit" | "withdraw" | "log-state" | "faucet" | "exit"> {
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
                {
                    name: "📊 Log Contract State",
                    value: "log-state",
                    short: "Log State",
                },
                {
                    name: "🪙 Faucet to Address (Lightnet)",
                    value: "faucet",
                    short: "Faucet",
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

async function showFirstMenu(): Promise<"warm-up-cache" | "contract-actions"> {
    console.log("\n");
    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: "🎯 What would you like to do?",
            choices: [
                {
                    name: "🔥 Warm-up Cache",
                    value: "warm-up-cache",
                    short: "Warm-up Cache",
                },
                {
                    name: "🏛️ Contract Actions (Deposit/Withdraw)",
                    value: "contract-actions",
                    short: "Contract Actions",
                },
            ],
            pageSize: 10,
            loop: false,
        },
    ]);

    return action;
}

async function showExitMenu(): Promise<"exit" | "main-menu"> {
    console.log("\n");
    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: "🎯 What would you like to do?",
            choices: [
                {
                    name: "🚪 Exit Application",
                    value: "exit",
                    short: "Exit",
                },
                {
                    name: "🏠 Return to Main Menu",
                    value: "main-menu",
                    short: "Main Menu",
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

        setNetwork();

        const firstAction = await showFirstMenu();

        if (firstAction === "warm-up-cache") {
            await performWarmUpCache();

            const nextAction = await showExitMenu();
            if (nextAction === "exit") {
                console.log("\n Exit cli");
                process.exit(0);
            }
        }

        await initializeSigner();

        const stopCompileSpinner = createLoadingSpinner(
            "Compiling contracts (this may take a moment)..."
        );
        await cacheCompile("reduce");
        stopCompileSpinner();

        while (true) {
            const action = await showMainMenu();

            if (action === "exit") {
                console.log("\n Exit cli");
                break;
            }

            try {
                if (action === "deposit") {
                    await performDeposit(signerPrivateKey, contractPrivateKey, contractInstance);
                } else if (action === "withdraw") {
                    await performWithdraw(signerPrivateKey, contractPrivateKey, contractInstance);
                } else if (action === "log-state") {
                    await performLogContractState(contractInstance);
                } else if (action === "faucet") {
                    await performFaucetToAddress();
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
                    console.log("\n Exit cli");
                    break;
                }
            } catch (error) {
                printError("\n Transaction failed!");
                console.log(
                    `📋 Error details: ${error instanceof Error ? error.message : String(error)}\n`
                );

                const { retryChoice } = await inquirer.prompt([
                    {
                        type: "list",
                        name: "retryChoice",
                        message: "What next?",
                        choices: [
                            {
                                name: "Try Again",
                                value: "retry",
                                short: "Retry",
                            },
                            {
                                name: "Return to Main Menu",
                                value: "menu",
                                short: "Main Menu",
                            },
                            {
                                name: "Exit Application",
                                value: "exit",
                                short: "Exit",
                            },
                        ],
                    },
                ]);

                if (retryChoice === "exit") {
                    console.log("\n Exit cli");
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
                    } else if (action === "log-state") {
                        await performLogContractState(contractInstance);
                    } else if (action === "faucet") {
                        await performFaucetToAddress();
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
