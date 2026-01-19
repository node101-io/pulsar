import { MockChain } from "../mockChain/mockChain.js";
import { MockGrpcServer } from "../mockRpc/mockGrpcServer.js";
import logger from "../../logger.js";

export class TestNode {
    private mockChain: MockChain;
    private grpcServer: MockGrpcServer;
    private blockInterval: number;

    constructor(validatorCount: number = 25, blockInterval: number = 5000, grpcPort: number = 50051) {
        this.blockInterval = blockInterval;
        this.mockChain = new MockChain(validatorCount, blockInterval);
        this.grpcServer = new MockGrpcServer(this.mockChain, grpcPort);
    }

    /**
     * Test node'u başlat
     */
    async start(): Promise<void> {
        logger.info("Starting test node...");

        try {
            // Mock chain'i başlat
            await this.mockChain.start();
            logger.info("Mock chain started");

            // gRPC server'ı başlat
            await this.grpcServer.start();
            logger.info("gRPC server started");

            logger.info("Test node started successfully", {
                validatorCount: this.mockChain.getValidators().length,
                blockInterval: this.blockInterval,
                grpcPort: 50051,
            });
        } catch (error) {
            logger.error("Failed to start test node", error as Error);
            throw error;
        }
    }

    /**
     * Test node'u durdur
     */
    async stop(): Promise<void> {
        logger.info("Stopping test node...");

        try {
            // Mock chain'i durdur
            this.mockChain.stop();
            logger.info("Mock chain stopped");

            // gRPC server'ı durdur
            await this.grpcServer.stop();
            logger.info("gRPC server stopped");

            logger.info("Test node stopped successfully");
        } catch (error) {
            logger.error("Error stopping test node", error as Error);
            throw error;
        }
    }

    /**
     * Node durumunu getir
     */
    getStatus() {
        return {
            chain: this.mockChain.getStatus(),
            grpcServer: {
                started: this.grpcServer.isStarted(),
            },
        };
    }

    /**
     * Mock chain'e erişim
     */
    getMockChain(): MockChain {
        return this.mockChain;
    }

    /**
     * gRPC server'a erişim
     */
    getGrpcServer(): MockGrpcServer {
        return this.grpcServer;
    }
}
