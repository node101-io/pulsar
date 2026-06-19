import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { Poseidon, PublicKey } from "o1js";
import { List } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
import { BlockData, VoteExt } from "../../common/types.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
} from "../../config/constants.js";
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
    abciClient: any,
    height: number,
): Promise<BlockData> {
    // VoteExtBody for block H is stored at H+2.
    // Contains the stateRoot, nextValidatorSetHash, and actionsReducedRoot
    // that validators actually signed — authoritative source.
    let body: {
        stateRoot: string;
        nextValidatorSetHash: string;
        actionsReducedRoot: string;
    } | null = null;
    try {
        body = await getVoteExtBody(abciClient, height);
    } catch (err) {
        // VoteExtBodyByHeight(H+2) fails for very early blocks because Cosmos SDK
        // staking has no historical info before the chain's first staking snapshot.
        // Fall back to app_hash from GetBlockByHeight as stateRoot.
        logger.warn(
            "VoteExtBody unavailable, falling back to block header for stateRoot",
            {
                blockHeight: height,
                error: (err as any)?.message,
                event: "vote_ext_body_fallback",
            },
        );
    }

    let stateRoot: string;
    let validatorListHash: string | undefined;
    let actionsReducedRoot: string;

    if (body) {
        stateRoot = body.stateRoot;
        validatorListHash = body.nextValidatorSetHash;
        actionsReducedRoot = body.actionsReducedRoot;
    } else {
        const blockRes = await new Promise<any>((resolve, reject) => {
            tmClient.GetBlockByHeight(
                { height: height.toString() },
                (e: unknown, r: any) => {
                    if (e) reject(e as Error);
                    else resolve(r);
                },
            );
        });
        stateRoot = parseTendermintBlockResponse(blockRes).blockHash;
        validatorListHash = undefined; // will be computed from validators in storePulsarBlock
        actionsReducedRoot = "0";
    }

    const voteExt = await getVoteExtsByHeight(vpClient, height);

    // Validators needed for ordering vote extensions in worker.ts.
    // Sorted by Mina pubkey X coordinate ascending to match the chain's
    // nextValidatorSetHash computation order.
    const validators = await getValidatorSet(tmClient, krClient, height);
    const sortedValidators = sortValidatorsByX(validators);

    return {
        height,
        stateRoot,
        validators: sortedValidators,
        validatorListHash,
        actionsReducedRoot,
        voteExt,
    };
}

async function getVoteExtBody(
    abciClient: any,
    height: number,
): Promise<{
    stateRoot: string;
    nextValidatorSetHash: string;
    actionsReducedRoot: string;
}> {
    // VoteExtBody for block H is accessible via VoteExtBodyByHeight(H+2).
    const bodyHeight = height + 2;
    return new Promise((resolve, reject) => {
        abciClient.VoteExtBodyByHeight(
            { vote_extension_height: bodyHeight },
            (err: unknown, res: any) => {
                if (err) {
                    logger.error("VoteExtBodyByHeight gRPC call failed", {
                        message: (err as any)?.message,
                        code: (err as any)?.code,
                        blockHeight: height,
                        bodyHeight,
                        event: "vote_ext_body_error",
                    });
                    return reject(err as Error);
                }

                const body = res.vote_ext_body ?? res.voteExtBody ?? res;

                const stateRootRaw =
                    body.current_state_root ?? body.currentStateRoot;
                const stateRoot = protoBufferToDecStr(stateRootRaw);

                const nextValSetRaw =
                    body.next_validator_set_hash ?? body.nextValidatorSetHash;
                const nextValidatorSetHash = protoBufferToDecStr(nextValSetRaw);

                // actionsReducedRoot is a string in the proto — convert to BigInt via UTF-8 bytes
                const actionsRootStr: string =
                    body.actions_reduced_root ?? body.actionsReducedRoot ?? "";
                const actionsRootBytes = Buffer.from(actionsRootStr, "utf-8");
                const actionsReducedRoot =
                    actionsRootBytes.length > 0
                        ? BigInt(
                              "0x" + actionsRootBytes.toString("hex"),
                          ).toString()
                        : "0";

                logger.debug("VoteExtBody fetched", {
                    blockHeight: height,
                    stateRoot,
                    nextValidatorSetHash,
                    actionsReducedRoot,
                    event: "vote_ext_body_fetched",
                });

                resolve({
                    stateRoot,
                    nextValidatorSetHash,
                    actionsReducedRoot,
                });
            },
        );
    });
}

function protoBufferToDecStr(
    val: Buffer | Uint8Array | string | null | undefined,
): string {
    if (!val) return "0";
    const buf = Buffer.isBuffer(val)
        ? val
        : Buffer.from(val as string, "base64");
    if (buf.length === 0) return "0";
    return BigInt("0x" + buf.toString("hex")).toString();
}

function sortValidatorsByX(validators: string[]): string[] {
    return [...validators].sort((a, b) => {
        const xA = PublicKey.fromBase58(a).x.toBigInt();
        const xB = PublicKey.fromBase58(b).x.toBigInt();
        if (xA < xB) return -1;
        if (xA > xB) return 1;
        return 0;
    });
}

export async function getVoteExtsByHeight(
    vpClient: any,
    height: number,
): Promise<VoteExt[]> {
    return new Promise((resolve, reject) => {
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

            const persistedRaw =
                res.persisted_vote_extensions_block_height ??
                res.persistedVoteExtensionsBlockHeight;
            const persisted = Number(persistedRaw);

            // Expected: persistedH = height (the signed state height, not persistence height)
            if (persisted !== height) {
                logger.warn(
                    "VoteExtensions not available for block, storing empty",
                    {
                        blockHeight: height,
                        queryHeight,
                        persistedRaw,
                        event: "vote_extensions_not_available",
                    },
                );
                return resolve([]);
            }

            const extensions: any[] =
                res.vote_extensions ?? res.voteExtensions ?? [];
            const voteExt: VoteExt[] = extensions.map((v: any) => {
                // proto bytes fields arrive as Buffer from gRPC; guard against base64 string
                const pubKeyRaw = v.mina_public_key ?? v.minaPublicKey;
                const pubKeyBuf = Buffer.isBuffer(pubKeyRaw)
                    ? pubKeyRaw
                    : Buffer.from(pubKeyRaw, "base64");
                const sigRaw = v.vote_extension ?? v.voteExtension;
                const sigBuf = Buffer.isBuffer(sigRaw)
                    ? sigRaw
                    : Buffer.from(sigRaw, "base64");
                return {
                    index: "",
                    height,
                    validatorAddr: parseMinaPubkeyFromBytes(pubKeyBuf),
                    signature: decodeMinaSignature(sigBuf.toString("hex")),
                };
            });

            resolve(voteExt);
        });
    });
}

export async function storePulsarBlock(blockData: BlockData) {
    const { validators, ...rest } = blockData;

    // validatorListHash comes from VoteExtBodyByHeight (nextValidatorSetHash).
    // Fall back to computing it locally only if not provided.
    const validatorListHash =
        blockData.validatorListHash ?? computeValidatorListHash(validators);

    const block = await storeBlock({
        ...rest,
        validators,
        validatorListHash,
    });

    if (blockData.height >= EPOCH_START_HEIGHT) {
        const index =
            (blockData.height - EPOCH_START_HEIGHT) % BLOCK_EPOCH_SIZE;
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
            const anyValue = Buffer.from(v.pub_key?.value ?? []);
            const pubKeyBytes =
                anyValue.length >= 34
                    ? anyValue.subarray(2, 34)
                    : Buffer.alloc(0);
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
