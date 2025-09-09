import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import { BlockData, VoteExt } from "./interfaces.js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { PublicKey } from "o1js";
import logger from "./logger.js";
import {
    parseTendermintBlockResponse,
    decodeMinaSignature,
    parseValidatorSetResponse,
} from "./utils.js";

const POLL_INTERVAL_MS = 5_000;

const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
const MINA_KEYS_SERVICE_NAME = "interchain_security.minakeys.Query";

export class PulsarClient extends EventEmitter {
    rpcAddress: string;
    pollInterval: number;
    running: boolean;
    timer?: NodeJS.Timeout;
    lastSeenHeight: number;
    tmClient: any;
    mkClient: any;

    constructor(
        rpcAddress = "localhost:50051",
        initialHeight = 0,
        pollInterval = POLL_INTERVAL_MS
    ) {
        super();
        this.rpcAddress = rpcAddress;
        this.pollInterval = pollInterval;
        this.running = false;
        this.lastSeenHeight = initialHeight;

        logger.info("Pulsar client initialized", {
            rpcAddress: this.rpcAddress,
            pollInterval,
            initialHeight,
            event: "client_initialized",
        });
    }

    private async createClient(_serviceName: string, rpcAddress: string) {
        const credentials = grpc.credentials.createInsecure();

        const reflectionClient = new GrpcReflection(rpcAddress, credentials);

        const serviceDescriptor = await reflectionClient.getDescriptorBySymbol(_serviceName);

        const packageObject = serviceDescriptor.getPackageObject({
            keepCase: true,
            enums: String,
            longs: String,
        });
        let serviceClass: any = packageObject;

        const servicePath = _serviceName.split(".");
        const serviceName = servicePath.pop();

        for (const part of servicePath) serviceClass = serviceClass[part];

        serviceClass = serviceClass[serviceName!];

        return new serviceClass(rpcAddress, credentials);
    }

    async start() {
        if (this.running) return;

        try {
            this.tmClient = await this.createClient(TENDERMINT_SERVICE_NAME, this.rpcAddress);
            this.mkClient = await this.createClient(MINA_KEYS_SERVICE_NAME, this.rpcAddress);

            this.running = true;
            this.emit("start");

            await this.syncMissedBlocks();

            this.timer = setInterval(() => this.pollLatestBlock(), this.pollInterval);
        } catch (error) {
            this.emit("Error on start retrying....", error);
            setTimeout(() => this.start(), 5000);
        }
    }

    pollLatestBlock() {
        this.tmClient.GetLatestBlock({}, (err: any, res: any) => {
            if (err) return this.emit("error", err as Error);

            const { height } = parseTendermintBlockResponse(res);

            if (height > this.lastSeenHeight + 1) {
                if (height === this.lastSeenHeight + 2) {
                    this.getBlockAndEmit(height - 1).catch((error) =>
                        this.emit("error", error as Error)
                    );
                } else {
                    logger.warn("Missed blocks detected, syncing", {
                        lastSeenHeight: this.lastSeenHeight,
                        currentHeight: height,
                        missedBlocks: Number(height - this.lastSeenHeight - 1),
                        event: "missed_blocks_detected",
                    });
                    this.syncMissedBlocks().catch((error) => this.emit("error", error as Error));
                }
            }
        });
    }

    async syncMissedBlocks() {
        return new Promise<void>((resolve, reject) => {
            this.tmClient.GetLatestBlock({}, async (err: any, res: any) => {
                if (err) return reject(err as Error);

                const { height } = parseTendermintBlockResponse(res);
                logger.info("Syncing missed blocks", {
                    fromHeight: Number(this.lastSeenHeight) + 1,
                    toHeight: Number(height) - 1,
                    blocksToSync: Number(height) - 1 - Number(this.lastSeenHeight),
                    event: "block_sync_started",
                });

                for (let h = this.lastSeenHeight + 1; h < height; ++h) {
                    await this.getBlockAndEmit(h);
                }
                resolve();
            });
        });
    }

    async getBlockAndEmit(height: number): Promise<void> {
        const { blockHash: stateRoot } = parseTendermintBlockResponse(
            await new Promise((resolve, reject) => {
                this.tmClient.GetBlockByHeight(
                    { height: height.toString() },
                    (err: any, res: any) => {
                        if (err) return reject(err as Error);
                        resolve(res);
                    }
                );
            })
        );
        const validators = await this.getValidatorSet(height);
        const voteExt = await this.getVoteExt(height);

        const blockData: BlockData = {
            height,
            stateRoot,
            validators,
            voteExt,
        };

        this.emit("newPulsarBlock", {
            blockData,
        });
        this.lastSeenHeight = height;
    }

    async getMinaPubKeyFromCosmosAddress(cosmosAddress: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.mkClient.KeyStore({ index: cosmosAddress }, (err: any, res: any) => {
                if (err) return reject(err as Error);

                try {
                    const encodedPubkey = res?.keyStore.minaPublicKey;

                    if (!encodedPubkey) {
                        return reject(
                            new Error("No Mina public key found for the given Cosmos address")
                        );
                    }

                    this.recoverPubkeyFromEncoded(encodedPubkey)
                        .then((pubkey) => resolve(pubkey))
                        .catch((error) => reject(error));
                } catch (error) {
                    logger.error("Failed to parse block response", error, {
                        event: "parse_error",
                        blockHeight: res?.block?.header?.height,
                    });
                    reject(new Error("Failed to parse Mina public key from response"));
                }
            });
        });
    }

    async getCosmosValidatorSet(height: number): Promise<string[]> {
        return new Promise((resolve, reject) => {
            this.tmClient.GetValidatorSetByHeight(
                { height: height.toString() },
                (err: any, res: any) => {
                    if (err) return reject(err as Error);

                    const validators = parseValidatorSetResponse(res);
                    resolve(validators);
                }
            );
        });
    }

    async getValidatorSet(height: number): Promise<string[]> {
        try {
            const validators = await this.getCosmosValidatorSet(height);
            if (validators.length === 0) {
                throw new Error(`No validators found for height ${height}`);
            }

            const minaPubKeys: string[] = [];
            for (const validator of validators) {
                try {
                    const pubkey = await this.getMinaPubKeyFromCosmosAddress(validator);
                    minaPubKeys.push(pubkey);
                } catch (error) {
                    logger.error(
                        `Error retrieving Mina public key for validator ${validator}`,
                        error,
                        {
                            validator,
                            blockHeight: height,
                            event: "validator_key_retrieval_error",
                        }
                    );
                }
            }
            return minaPubKeys;
        } catch (error) {
            logger.error(`Error retrieving validator set for height ${height}`, error, {
                blockHeight: height,
                event: "validator_set_retrieval_error",
            });
            throw error;
        }
    }

    async getVoteExt(height: number): Promise<VoteExt[]> {
        let voteExt: VoteExt[] = [];

        let pageReq: any = { block_height: height.toString(), pagination: { limit: 200 } };

        for (;;) {
            const page = await new Promise<any>((resolve, reject) => {
                this.mkClient.VoteExtByHeight(pageReq, (err: unknown, res: any) => {
                    if (err) return reject(err);
                    resolve(res);
                });
            });

            voteExt = await this.parseVoteExtResponse(page);

            const nextKey = page.pagination?.next_key;
            if (!nextKey || nextKey.length === 0) break;

            pageReq.pagination.key = nextKey;
        }
        return voteExt;
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.emit("stop");
    }

    async parseVoteExtResponse(res: any): Promise<VoteExt[]> {
        let voteExt: VoteExt[] = [];
        if (!res || !Array.isArray(res.voteExt)) return voteExt;

        try {
            for (const v of res.voteExt) {
                const recoveredPubkey = await this.recoverPubkeyFromEncoded(v.validatorAddr);

                const parsedVoteExt: VoteExt = {
                    index: v.index,
                    height: Number(v.height),
                    validatorAddr: recoveredPubkey,
                    signature: decodeMinaSignature(v.signature),
                };

                voteExt.push(parsedVoteExt);
            }
        } catch (error) {
            logger.error("Error parsing vote extension response", error, {
                blockHeight: res?.voteExt?.[0]?.height,
                event: "vote_extension_parse_error",
            });
            throw error;
        }

        return voteExt;
    }

    async recoverPubkeyFromEncoded(encoded: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                this.mkClient.GetMinaPubkey({ validatorAddr: encoded }, (err: any, res: any) => {
                    if (err) {
                        logger.error("Error retrieving Mina public key", err, {
                            encodedAddress: encoded,
                            event: "mina_pubkey_retrieval_error",
                        });
                        reject(err);
                        return;
                    }

                    try {
                        const publicKey = PublicKey.from({
                            x: res.x,
                            isOdd: res.is_odd === "true" ? true : false,
                        }).toBase58();
                        resolve(publicKey);
                    } catch (parseError) {
                        logger.error("Error parsing public key", parseError, {
                            encodedAddress: encoded,
                            responseData: res,
                            event: "pubkey_parse_error",
                        });
                        reject(parseError);
                    }
                });
            } catch (error) {
                logger.error("Error recovering public key", error, {
                    encodedAddress: encoded,
                    event: "pubkey_recovery_error",
                });
                reject(error);
            }
        });
    }
}
