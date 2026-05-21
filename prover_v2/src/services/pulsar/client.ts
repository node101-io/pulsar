import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { Poseidon, PublicKey } from "o1js";
import { List } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
import { BlockData, VoteExt } from "../../common/types.js";
import { BLOCK_EPOCH_SIZE, EPOCH_START_HEIGHT } from "../../config/constants.js";
import {
    decodeMinaSignature,
    parseTendermintBlockResponse,
    parseMinaPubkeyFromBytes,
} from "./parser.js";

export async function createClient(
    serviceName: string,
    rpcAddress: string,
    credentials: grpc.ChannelCredentials,
) {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const serviceDescriptor = await reflectionClient.getDescriptorBySymbol(
        serviceName,
    );

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
    vpClient: any,
    krClient: any,
    height: number,
): Promise<BlockData> {
    const { blockHash: stateRoot } = parseTendermintBlockResponse(
        await new Promise<any>((resolve, reject) => {
            tmClient.GetBlockByHeight(
                { height: height.toString() },
                (err: unknown, res: any) => {
                    if (err) return reject(err as Error);
                    resolve(res);
                },
            );
        }),
    );

    const voteExt = await getVoteExtsByHeight(vpClient, height);
    const validators = await getValidatorSet(tmClient, krClient, height);

    return { height, stateRoot, validators, voteExt };
}

export async function getVoteExtsByHeight(
    vpClient: any,
    height: number,
): Promise<VoteExt[]> {
    return new Promise((resolve, reject) => {
        // Vote extensions for block H sign H's state root, created during
        // block H+1's consensus, persisted at H+1, accessible at H+3 (lag=2).
        const queryHeight = height + 3;
        const metadata = new grpc.Metadata();
        metadata.add("x-cosmos-block-height", queryHeight.toString());

        vpClient.VoteExtensions({}, metadata, (err: unknown, res: any) => {
            if (err) {
                logger.error("VoteExtensions gRPC call failed", {
                    message: (err as any)?.message,
                    code: (err as any)?.code,
                    details: (err as any)?.details,
                    blockHeight: height,
                    queryHeight,
                    event: "vote_extensions_error",
                });
                return reject(err as Error);
            }

            // proto-loader with keepCase may return snake_case or camelCase
            const persistedRaw =
                res.persisted_vote_extensions_block_height ??
                res.persistedVoteExtensionsBlockHeight;
            const persisted = Number(persistedRaw);

            // Expected: persistedH = height+1 (vote exts created in H+1's consensus)
            if (persisted !== height + 1) {
                logger.warn("VoteExtensions not available for block, storing empty", {
                    blockHeight: height,
                    queryHeight,
                    persistedRaw,
                    event: "vote_extensions_not_available",
                });
                return resolve([]);
            }

            const extensions: any[] =
                res.vote_extensions ?? res.voteExtensions ?? [];
            const voteExt: VoteExt[] = extensions.map((v: any) => ({
                index: "",
                height,
                validatorAddr: parseMinaPubkeyFromBytes(
                    Buffer.from(v.mina_public_key ?? v.minaPublicKey, "base64"),
                ),
                signature: decodeMinaSignature(
                    Buffer.from(
                        v.vote_extension ?? v.voteExtension,
                        "base64",
                    ).toString("hex"),
                ),
            }));

            resolve(voteExt);
        });
    });
}

export async function storePulsarBlock(blockData: BlockData) {
    const { validators, ...rest } = blockData;

    const validatorListHash = computeValidatorListHash(validators);

    const block = await storeBlock({
        ...rest,
        validators,
        validatorListHash,
    });

    if (blockData.height >= EPOCH_START_HEIGHT) {
        const index = (blockData.height - EPOCH_START_HEIGHT) % BLOCK_EPOCH_SIZE;
        await storeBlockInBlockEpoch(blockData.height, block._id, index);
    }

    logger.info("Stored Pulsar block", {
        blockHeight: blockData.height,
        validatorsCount: validators.length,
        event: "pulsar_block_stored",
    });
}

async function getValidatorSet(
    tmClient: any,
    krClient: any,
    height: number,
): Promise<string[]> {
    try {
        const res = await new Promise<any>((resolve, reject) => {
            tmClient.GetValidatorSetByHeight(
                { height: height.toString() },
                (err: unknown, r: any) => {
                    if (err) return reject(err as Error);
                    resolve(r);
                },
            );
        });

        const minaPubKeys: string[] = [];
        for (const v of res?.validators ?? []) {
            // pub_key is google.protobuf.Any: {type_url, value: Buffer}
            // value encodes Ed25519PubKey as proto field 1 (0x0a 0x20 <32 bytes>)
            const anyValue = Buffer.from(v.pub_key?.value ?? []);
            const pubKeyBytes = anyValue.length >= 34 ? anyValue.subarray(2, 34) : Buffer.alloc(0);
            try {
                const minaKey = await getMinaPubKeyFromEd25519(
                    krClient,
                    pubKeyBytes,
                );
                minaPubKeys.push(minaKey);
            } catch (error) {
                logger.error("Error retrieving Mina public key for validator", {
                    error,
                    blockHeight: height,
                    event: "validator_key_retrieval_error",
                });
            }
        }
        return minaPubKeys;
    } catch (error) {
        logger.error(`Error retrieving validator set for height ${height}`, {
            error,
            blockHeight: height,
            event: "validator_set_retrieval_error",
        });
        throw error;
    }
}

async function getMinaPubKeyFromEd25519(
    krClient: any,
    pubKeyBytes: Buffer,
): Promise<string> {
    return new Promise((resolve, reject) => {
        krClient.GetValidatorMinaPubKey(
            { validator_cosmos_pub_key: pubKeyBytes },
            (err: unknown, res: any) => {
                if (err) return reject(err as Error);
                try {
                    resolve(
                        parseMinaPubkeyFromBytes(
                            Buffer.from(res.validator_mina_pub_key),
                        ),
                    );
                } catch (parseError) {
                    reject(parseError);
                }
            },
        );
    });
}

export function computeValidatorListHash(validators: string[]): string {
    const validatorsList = List.empty();

    for (const validator of validators) {
        validatorsList.push(
            Poseidon.hash(PublicKey.fromBase58(validator).toFields()),
        );
    }

    return validatorsList.hash.toString();
}
