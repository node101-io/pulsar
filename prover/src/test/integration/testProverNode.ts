import { MockChain } from "../mockChain/mockChain.js";
import { MockGrpcServer } from "../mockRpc/mockGrpcServer.js";
import logger from "../../logger.js";

export interface TestNodeConfig {
    validatorCount?: number;
    blockInterval?: number;
    grpcPort?: number;
    
    minaNetwork?: "devnet" | "mainnet" | "lightnet";
    minaContractAddress?: string;
    minaRemoteServerUrl?: string;
    
    pulsarGrpcEndpoint?: string;
}

export class TestNode {
    private mockChain: MockChain;
    private grpcServer: MockGrpcServer;
    private blockInterval: number;
    private config: Required<TestNodeConfig>;

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
        this.mockChain = new MockChain(this.config.blockInterval);
        this.grpcServer = new MockGrpcServer(this.mockChain, this.config.grpcPort);
    }

    async start(): Promise<void> {
        logger.info("Starting test node...");

        try {
            await this.mockChain.start();
            logger.info("Mock chain started");

            await this.grpcServer.start();
            logger.info("gRPC server started");

            logger.info("Test node started successfully", {
                validatorCount: this.mockChain.getValidators().length,
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

    async stop(): Promise<void> {
        logger.info("Stopping test node...");

        try {
            this.mockChain.stop();
            logger.info("Mock chain stopped");

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
            chain: this.mockChain.getStatus(),
            grpcServer: {
                started: this.grpcServer.isStarted(),
            },
        };
    }

    getMockChain(): MockChain {
        return this.mockChain;
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
