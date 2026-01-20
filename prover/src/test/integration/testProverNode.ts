import { MockChain } from "../mockChain/mockChain.js";
import { MockGrpcServer } from "../mockRpc/mockGrpcServer.js";
import logger from "../../logger.js";
import { Lightnet, Mina, PrivateKey, AccountUpdate, UInt64, fetchAccount } from "o1js";
import { DeployScripts, setMinaNetwork } from "pulsar-contracts";

export interface TestNodeConfig {
    validatorCount?: number;
    blockInterval?: number;
    grpcPort?: number;
    
    minaNetwork?: "devnet" | "mainnet" | "lightnet";
    minaContractAddress?: string;
    minaRemoteServerUrl?: string;
    
    pulsarGrpcEndpoint?: string;
}

async function checkLightnetAvailable(): Promise<boolean> {
    const lightnetEndpoint = process.env.DOCKER
        ? "http://mina-local-lightnet:8080/graphql"
        : "http://localhost:8080/graphql";

    try {
        const response = await fetch(lightnetEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: "{ bestChain(maxLength: 1) { stateHash } }",
            }),
        });

        if (response.ok) {
            const data = await response.json();
            return data && !data.errors;
        }
        return false;
    } catch (error) {
        return false;
    }
}

export class TestProverNode {
    private mockChain: MockChain | null = null;
    private grpcServer: MockGrpcServer;
    private blockInterval: number;
    private config: Required<TestNodeConfig>;
    private useLightnet: boolean = false;
    private lightnetBlockInterval?: NodeJS.Timeout;

    constructor(config: TestNodeConfig = {}) {
        this.config = {
            validatorCount: config.validatorCount ?? 25,
            blockInterval: config.blockInterval ?? 5000,
            grpcPort: config.grpcPort ?? 50051,
            minaNetwork: config.minaNetwork ?? "lightnet",
            minaContractAddress: config.minaContractAddress ?? "",
            minaRemoteServerUrl: config.minaRemoteServerUrl ?? "",
            pulsarGrpcEndpoint: config.pulsarGrpcEndpoint ?? `localhost:${config.grpcPort ?? 50051}`,
        };

        this.blockInterval = this.config.blockInterval;
        this.grpcServer = new MockGrpcServer(null, this.config.grpcPort);
    }

    async start(): Promise<void> {
        logger.info("Starting test node...");

        try {
            if (process.env.DOCKER) {
                setMinaNetwork(this.config.minaNetwork);
                logger.info(`Mina network set to: ${this.config.minaNetwork} (Docker mode)`);
            } else {
                const serverUrl = this.config.minaRemoteServerUrl || "localhost";
                Mina.setActiveInstance(
                    Mina.Network({
                        mina: `http://${serverUrl}:8080/graphql`,
                        archive: `http://${serverUrl}:8282`,
                    })
                );
                logger.info(`Mina network configured with endpoint: ${serverUrl}:8080/graphql`);
            }

            if (this.config.minaNetwork === "lightnet") {
                const lightnetAvailable = await checkLightnetAvailable();
                if (lightnetAvailable) {
                    logger.info("Lightnet node is available, using real lightnet instead of mock chain");
                    this.useLightnet = true;
                    this.startLightnetBlockGeneration();
                } else {
                    logger.info("Lightnet node is not available, falling back to mock chain");
                    this.useLightnet = false;
                    this.mockChain = new MockChain(this.config.blockInterval);
                    this.grpcServer.setMockChain(this.mockChain);
                    await this.mockChain.start();
                    logger.info("Mock chain started");
                }
            } else {
                logger.info("Not using lightnet network, starting mock chain");
                this.useLightnet = false;
                this.mockChain = new MockChain(this.config.blockInterval);
                this.grpcServer.setMockChain(this.mockChain);
                await this.mockChain.start();
                logger.info("Mock chain started");
            }

            await this.grpcServer.start();
            logger.info("gRPC server started");

            logger.info("Test node started successfully", {
                useLightnet: this.useLightnet,
                validatorCount: this.mockChain ? this.mockChain.getValidators().length : 0,
                blockInterval: this.blockInterval,
                grpcPort: this.config.grpcPort,
                minaNetwork: this.config.minaNetwork,
                pulsarGrpcEndpoint: this.config.pulsarGrpcEndpoint,
            });
        } catch (error) {
            logger.error("Failed to start test node", error as Error);
            throw error;
        }
    }

    private startLightnetBlockGeneration(): void {
        logger.info(`Starting lightnet block generation (interval: ${this.config.blockInterval}ms)`);

        this.lightnetBlockInterval = setInterval(async () => {
            await this.sendLightnetTransaction();
        }, this.config.blockInterval);
    }

    private async sendLightnetTransaction(): Promise<void> {
        try {
            const lightnetEndpoint = process.env.DOCKER
                ? "http://mina-local-lightnet:8181"
                : "http://localhost:8181";

            const { privateKey } = await Lightnet.acquireKeyPair({
                isRegularAccount: true,
                lightnetAccountManagerEndpoint: lightnetEndpoint,
            });

            await fetchAccount({ publicKey: privateKey.toPublicKey() });

            const tx = await Mina.transaction(
                { sender: privateKey.toPublicKey(), fee: 1e9 },
                async () => {
                    const senderAccount = AccountUpdate.createSigned(privateKey.toPublicKey());
                    senderAccount.send({
                        to: privateKey.toPublicKey(),
                        amount: UInt64.from(1),
                    });
                }
            );

            await DeployScripts.waitTransactionAndFetchAccount(tx, [privateKey], [privateKey.toPublicKey()]);
            logger.debug("Lightnet transaction sent to trigger block creation");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn("Failed to send lightnet transaction for block generation", {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
            });
        }
    }

    async stop(): Promise<void> {
        logger.info("Stopping test node...");

        try {
            if (this.lightnetBlockInterval) {
                clearInterval(this.lightnetBlockInterval);
                this.lightnetBlockInterval = undefined;
                logger.info("Lightnet block generation stopped");
            }

            if (this.mockChain) {
                this.mockChain.stop();
                logger.info("Mock chain stopped");
            } else {
                logger.info("No mock chain to stop (using lightnet)");
            }

            await this.grpcServer.stop();
            logger.info("gRPC server stopped");

            logger.info("Test node stopped successfully");
        } catch (error) {
            logger.error("Error stopping test node", error as Error);
            throw error;
        }
    }

    getStatus() {
        return {
            useLightnet: this.useLightnet,
            chain: this.mockChain ? this.mockChain.getStatus() : { running: false, message: "Using real lightnet" },
            grpcServer: {
                started: this.grpcServer.isStarted(),
            },
        };
    }

    getMockChain(): MockChain | null {
        return this.mockChain;
    }

    isUsingLightnet(): boolean {
        return this.useLightnet;
    }

    getGrpcServer(): MockGrpcServer {
        return this.grpcServer;
    }

    getConfig(): Required<TestNodeConfig> {
        return { ...this.config };
    }

    getMinaConfig() {
        return {
            network: this.config.minaNetwork,
            contractAddress: this.config.minaContractAddress,
            remoteServerUrl: this.config.minaRemoteServerUrl,
        };
    }

    getPulsarGrpcEndpoint(): string {
        return this.config.pulsarGrpcEndpoint;
    }

    getGrpcPort(): number {
        return this.config.grpcPort;
    }
}
