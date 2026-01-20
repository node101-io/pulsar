import * as grpc from "@grpc/grpc-js";
import { Server, ServerCredentials } from "@grpc/grpc-js";
import { MockChain } from "../mockChain/mockChain.js";
import logger from "../../logger.js";
import {
    QueryGetKeyStoreRequest,
    QueryGetKeyStoreResponse,
    QueryVoteExtByHeightRequest,
    QueryVoteExtByHeightResponse,
    QueryGetMinaPubkeyRequest,
    QueryGetMinaPubkeyResponse,
    QueryService,
} from "../../generated/interchain_security/minakeys/query.js";
import { VoteExt as ProtoVoteExt } from "../../generated/interchain_security/minakeys/vote_ext.js";
import { KeyStore } from "../../generated/interchain_security/minakeys/key_store.js";

export class MockGrpcServer {
    private server: Server;
    private mockChain: MockChain | null;
    private port: number;
    private started: boolean = false;

    constructor(mockChain: MockChain | null, port: number = 50051) {
        this.server = new Server();
        this.mockChain = mockChain;
        this.port = port;
        this.setupServices();
    }

    setMockChain(mockChain: MockChain): void {
        this.mockChain = mockChain;
        this.setupServices();
    }

    private setupServices(): void {
        this.setupMinaKeysService();
    }

    private setupMinaKeysService(): void {
        this.server.addService(QueryService, {
            keyStore: (
                call: grpc.ServerUnaryCall<QueryGetKeyStoreRequest, QueryGetKeyStoreResponse>,
                callback: grpc.sendUnaryData<QueryGetKeyStoreResponse>
            ) => {
                try {
                    if (!this.mockChain) {
                        return callback({
                            code: grpc.status.UNAVAILABLE,
                            message: "Mock chain not available (using real lightnet)",
                        });
                    }
                    const { index } = call.request;
                    const validator = this.mockChain.getValidatorByCosmosAddress(index);

                    if (!validator) {
                        return callback({
                            code: grpc.status.NOT_FOUND,
                            message: `Validator not found for address: ${index}`,
                        });
                    }

                    const minaPubkey = validator.minaPublicKey;
                    
                    const cosmosPubkeyHex = Buffer.from(validator.cosmosPubkey).toString("hex");

                    const keyStore: KeyStore = {
                        cosmosPublicKey: cosmosPubkeyHex,
                        minaPublicKey: minaPubkey.toBase58(),
                        creator: validator.cosmosAddress,
                    };

                    const response: QueryGetKeyStoreResponse = {
                        keyStore,
                    };

                    callback(null, response);
                } catch (error) {
                    logger.error("Error in keyStore service", error as Error);
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (error as Error).message,
                    });
                }
            },

            voteExtByHeight: (
                call: grpc.ServerUnaryCall<QueryVoteExtByHeightRequest, QueryVoteExtByHeightResponse>,
                callback: grpc.sendUnaryData<QueryVoteExtByHeightResponse>
            ) => {
                try {
                    if (!this.mockChain) {
                        return callback({
                            code: grpc.status.UNAVAILABLE,
                            message: "Mock chain not available (using real lightnet)",
                        });
                    }
                    const { blockHeight, pagination } = call.request;
                    const height = parseInt(blockHeight);

                    const block = this.mockChain.getBlock(height);
                    if (!block) {
                        return callback({
                            code: grpc.status.NOT_FOUND,
                            message: `Block not found at height: ${height}`,
                        });
                    }

                    const protoVoteExts: ProtoVoteExt[] = block.voteExt.map((ve) => ({
                        index: ve.index,
                        height: ve.height.toString(),
                        validatorAddr: ve.validatorAddr,
                        signature: ve.signature,
                    }));

                    const response: QueryVoteExtByHeightResponse = {
                        voteExt: protoVoteExts,
                        pagination: pagination
                            ? {
                                  nextKey: Buffer.alloc(0),
                                  total: "0",
                              }
                            : undefined,
                    };

                    callback(null, response);
                } catch (error) {
                    logger.error("Error in voteExtByHeight service", error as Error);
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (error as Error).message,
                    });
                }
            },

            getMinaPubkey: (
                call: grpc.ServerUnaryCall<QueryGetMinaPubkeyRequest, QueryGetMinaPubkeyResponse>,
                callback: grpc.sendUnaryData<QueryGetMinaPubkeyResponse>
            ) => {
                try {
                    if (!this.mockChain) {
                        return callback({
                            code: grpc.status.UNAVAILABLE,
                            message: "Mock chain not available (using real lightnet)",
                        });
                    }
                    const { validatorAddr } = call.request;
                    const validator = this.mockChain.getValidatorByMinaPublicKey(validatorAddr);

                    if (!validator) {
                        return callback({
                            code: grpc.status.NOT_FOUND,
                            message: `Validator not found for Mina public key: ${validatorAddr}`,
                        });
                    }

                    const minaPubkey = validator.minaPublicKey;
                    const fields = minaPubkey.toFields();
                    const x = fields[0].toBigInt().toString();
                    const isOdd = fields[1].toBigInt().toString() === "1" ? "true" : "false";

                    const response: QueryGetMinaPubkeyResponse = {
                        x,
                        isOdd,
                    };

                    callback(null, response);
                } catch (error) {
                    logger.error("Error in getMinaPubkey service", error as Error);
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (error as Error).message,
                    });
                }
            },
        });
    }

    async start(): Promise<void> {
        if (this.started) {
            logger.warn("Mock gRPC server is already started");
            return;
        }

        return new Promise((resolve, reject) => {
            this.server.bindAsync(
                `0.0.0.0:${this.port}`,
                ServerCredentials.createInsecure(),
                (error, port) => {
                    if (error) {
                        logger.error("Failed to start mock gRPC server", error);
                        return reject(error);
                    }

                    this.server.start();
                    this.started = true;
                    logger.info(`Mock gRPC server started on port ${port}`);
                    resolve();
                }
            );
        });
    }

    async stop(): Promise<void> {
        if (!this.started) {
            return;
        }

        return new Promise<void>((resolve) => {
            this.server.tryShutdown((error) => {
                if (error) {
                    logger.error("Error shutting down mock gRPC server", error);
                } else {
                    logger.info("Mock gRPC server stopped");
                }
                this.started = false;
                resolve();
            });
        });
    }

    isStarted(): boolean {
        return this.started;
    }
}
