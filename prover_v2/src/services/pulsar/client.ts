import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { Poseidon, PublicKey } from "o1js";
import { List } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
import { BlockData, VoteExt } from "../../common/types.js";
import { BLOCK_EPOCH_SIZE } from "../../config/constants.js";
import { decodeMinaSignature, parseTendermintBlockResponse, parseValidatorSetResponse } from "./parser.js";

export async function createClient(
    serviceName: string,
    rpcAddress: string,
    credentials: grpc.ChannelCredentials,
) {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const serviceDescriptor =
        await reflectionClient.getDescriptorBySymbol(serviceName);

    const packageObject = serviceDescriptor.getPackageObject({
        keepCase: true,
        enums: String,
        longs: String,
    });
    let serviceClass: any = packageObject;

    const servicePath = serviceName.split(".");
    const finalServiceName = servicePath.pop();

    for (const part of servicePath) serviceClass = serviceClass[part];
    serviceClass = serviceClass[finalServiceName!];

    return new serviceClass(rpcAddress, credentials);
}

export async function getLatestHeight(tmClient: any): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        tmClient.GetLatestBlock({}, (err: unknown, res: any) => {
            if (err) return reject(err as Error);

            const { height } = parseTendermintBlockResponse(res);
            resolve(height);
        });
    });
}

export async function getBlockData(
    tmClient: any,
    mkClient: any,
    height: number,
): Promise<BlockData> {
    const { blockHash: stateRoot } = parseTendermintBlockResponse(
        await new Promise((resolve, reject) => {
            tmClient.GetBlockByHeight(
                { height: height.toString() },
                (err: unknown, res: any) => {
                    if (err) return reject(err as Error);
                    resolve(res);
                },
            );
        }),
    );

    const validators = await getValidatorSet(tmClient, mkClient, height);
    const voteExt = await getVoteExt(mkClient, height);

    return {
        height,
        stateRoot,
        validators,
        voteExt,
    };
}

export async function getCosmosValidatorSet(
    tmClient: any,
    height: number,
): Promise<string[]> {
    return new Promise((resolve, reject) => {
        tmClient.GetValidatorSetByHeight(
            { height: height.toString() },
            (err: unknown, res: any) => {
                if (err) return reject(err as Error);

                const validators = parseValidatorSetResponse(res);
                resolve(validators);
            },
        );
    });
}

export async function getVoteExt(mkClient: any, height: number): Promise<VoteExt[]> {
    let voteExt: VoteExt[] = [];

    const pageReq: any = {
        block_height: height.toString(),
        pagination: { limit: 200 },
    };

    for (;;) {
        const page = await new Promise<any>((resolve, reject) => {
            mkClient.VoteExtByHeight(
                pageReq,
                (err: unknown, res: any) => {
                    if (err) return reject(err);
                    resolve(res);
                },
            );
        });

        voteExt = await parseVoteExtResponse(mkClient, page);

        const nextKey = page.pagination?.next_key;
        if (!nextKey || nextKey.length === 0) break;

        pageReq.pagination.key = nextKey;
    }
    return voteExt;
}

export async function storePulsarBlock(blockData: BlockData) {
    const { validators, ...rest } = blockData;

    const validatorListHash = computeValidatorListHash(validators);

    const block = await storeBlock({
        ...rest,
        validators,
        validatorListHash,
    });

    const index = blockData.height % BLOCK_EPOCH_SIZE;
    await storeBlockInBlockEpoch(blockData.height, block._id, index);

    logger.info("Stored Pulsar block", {
        blockHeight: blockData.height,
        validatorsCount: validators.length,
        event: "pulsar_block_stored",
    });
}

// Internal helpers

async function getMinaPubKeyFromCosmosAddress(
    mkClient: any,
    cosmosAddress: string,
): Promise<string> {
    return new Promise((resolve, reject) => {
        mkClient.KeyStore(
            { index: cosmosAddress },
            (err: unknown, res: any) => {
                if (err) return reject(err as Error);

                try {
                    const encodedPubkey = res?.keyStore.minaPublicKey;

                    if (!encodedPubkey) {
                        return reject(
                            new Error(
                                "No Mina public key found for the given Cosmos address",
                            ),
                        );
                    }

                    recoverPubkeyFromEncoded(mkClient, encodedPubkey)
                        .then((pubkey) => resolve(pubkey))
                        .catch((error) => reject(error));
                } catch (error) {
                    logger.error(
                        "Failed to parse Mina public key response",
                        {
                            error,
                            event: "parse_error",
                            cosmosAddress,
                        },
                    );
                    reject(
                        new Error(
                            "Failed to parse Mina public key from response",
                        ),
                    );
                }
            },
        );
    });
}

async function getValidatorSet(
    tmClient: any,
    mkClient: any,
    height: number,
): Promise<string[]> {
    try {
        const validators = await getCosmosValidatorSet(tmClient, height);
        if (validators.length === 0) {
            throw new Error(`No validators found for height ${height}`);
        }

        const minaPubKeys: string[] = [];
        for (const validator of validators) {
            try {
                const pubkey = await getMinaPubKeyFromCosmosAddress(
                    mkClient,
                    validator,
                );
                minaPubKeys.push(pubkey);
            } catch (error) {
                logger.error(
                    `Error retrieving Mina public key for validator ${validator}`,
                    {
                        error,
                        validator,
                        blockHeight: height,
                        event: "validator_key_retrieval_error",
                    },
                );
            }
        }
        return minaPubKeys;
    } catch (error) {
        logger.error(
            `Error retrieving validator set for height ${height}`,
            {
                error,
                blockHeight: height,
                event: "validator_set_retrieval_error",
            },
        );
        throw error;
    }
}

async function parseVoteExtResponse(
    mkClient: any,
    res: any,
): Promise<VoteExt[]> {
    let voteExt: VoteExt[] = [];
    if (!res || !Array.isArray(res.voteExt)) return voteExt;

    try {
        for (const v of res.voteExt) {
            const recoveredPubkey = await recoverPubkeyFromEncoded(
                mkClient,
                v.validatorAddr,
            );

            const parsedVoteExt: VoteExt = {
                index: v.index,
                height: Number(v.height),
                validatorAddr: recoveredPubkey,
                signature: decodeMinaSignature(v.signature),
            };

            voteExt.push(parsedVoteExt);
        }
    } catch (error) {
        logger.error("Error parsing vote extension response", {
            error,
            blockHeight: res?.voteExt?.[0]?.height,
            event: "vote_extension_parse_error",
        });
        throw error;
    }

    return voteExt;
}

async function recoverPubkeyFromEncoded(
    mkClient: any,
    encoded: string,
): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            mkClient.GetMinaPubkey(
                { validatorAddr: encoded },
                (err: unknown, res: any) => {
                    if (err) {
                        logger.error(
                            "Error retrieving Mina public key",
                            {
                                error: err,
                                encodedAddress: encoded,
                                event: "mina_pubkey_retrieval_error",
                            },
                        );
                        reject(err);
                        return;
                    }

                    try {
                        const publicKey = PublicKey.from({
                            x: res.x,
                            isOdd: res.is_odd === "true",
                        }).toBase58();
                        resolve(publicKey);
                    } catch (parseError) {
                        logger.error(
                            "Error parsing public key",
                            {
                                error: parseError,
                                encodedAddress: encoded,
                                responseData: res,
                                event: "pubkey_parse_error",
                            },
                        );
                        reject(parseError);
                    }
                },
            );
        } catch (error) {
            logger.error("Error recovering public key", {
                error,
                encodedAddress: encoded,
                event: "pubkey_recovery_error",
            });
            reject(error);
        }
    });
}

function computeValidatorListHash(validators: string[]): string {
    const validatorsList = List.empty();

    for (const validator of validators) {
        validatorsList.push(
            Poseidon.hash(PublicKey.fromBase58(validator).toFields()),
        );
    }

    return validatorsList.hash.toString();
}

export { getMinaPubKeyFromCosmosAddress, getValidatorSet, computeValidatorListHash };
