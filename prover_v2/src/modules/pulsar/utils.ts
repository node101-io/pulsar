import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { List } from "pulsar-contracts";
import { Poseidon, PublicKey, Signature } from "o1js";

import logger from "../../logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../db/index.js";
import { BLOCK_EPOCH_SIZE } from "../utils/constants.js";
import { blockProverQ } from "../processors/utils/queue.js";
import { DEFAULT_JOB_OPTIONS, blockProverJobId } from "../processors/utils/jobOptions.js";
import {
    BlockParserResult,
    BlockData,
    VoteExt,
} from "../utils/interfaces.js";

export {
    parseTendermintBlockResponse,
    decodeMinaSignature,
    parseValidatorSetResponse,
    createClient,
    getLatestHeight,
    getBlockData,
    getMinaPubKeyFromCosmosAddress,
    getCosmosValidatorSet,
    getValidatorSet,
    getVoteExt,
    computeValidatorListHash,
    storePulsarBlock,
};

function parseTendermintBlockResponse(res: any): BlockParserResult {
    const header = res?.block?.header;
    const blockId = res?.block_id?.hash || null;
    const blockHash = BigInt(
        "0x" + Buffer.from(header.app_hash, "base64").toString("hex"),
    ).toString();
    const height = header?.height ? Number(header.height) : NaN;
    const chainId = header?.chain_id || "";
    const proposerAddress = header?.proposer_address || "";
    const timeSec = Number(header?.time?.seconds || 0);
    const timeNanos = Number(header?.time?.nanos || 0);
    const time = new Date(timeSec * 1e3 + timeNanos / 1e6);

    const txs: string[] = res?.block?.data?.txs ?? [];
    const txsDecoded: string[] = txs.map((t: string) => {
        try {
            const decoded = Buffer.from(t, "base64").toString("utf-8");
            return decoded;
        } catch {
            return "";
        }
    });

    const signatures = res?.block?.last_commit?.signatures ?? [];
    const lastCommitSignatures = signatures.map((sig: any) => ({
        validator_address: sig?.validator_address ?? "",
        signature: sig?.signature ?? "",
        block_id_flag: sig?.block_id_flag ?? "",
        timestamp: sig?.timestamp
            ? new Date(
                  Number(sig.timestamp.seconds || 0) * 1e3 +
                      Number(sig.timestamp.nanos || 0) / 1e6,
              )
            : null,
    }));

    return {
        blockId,
        blockHash,
        height,
        chainId,
        proposerAddress,
        time,
        txs,
        txsDecoded,
        lastCommitSignatures,
        hashes: {
            appHash: header?.app_hash || "",
            dataHash: header?.data_hash || "",
            validatorsHash: header?.validators_hash || "",
            consensusHash: header?.consensus_hash || "",
            evidenceHash: header?.evidence_hash || "",
            lastCommitHash: header?.last_commit_hash || "",
            lastResultsHash: header?.last_results_hash || "",
            nextValidatorsHash: header?.next_validators_hash || "",
        },
    };
}

function decodeMinaSignature(signatureHex: string): string {
    const sigBuffer = Buffer.from(signatureHex, "hex");
    const rHex = sigBuffer.slice(0, 32).toString("hex");
    const sHex = sigBuffer.slice(32, 64).toString("hex");

    return Signature.fromValue({
        r: BigInt("0x" + rHex),
        s: BigInt("0x" + sHex),
    }).toBase58();
}

function parseValidatorSetResponse(res: any): string[] {
    return res?.validators.map((v: any) => v.address);
}

async function createClient(
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

async function getLatestHeight(tmClient: any): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        tmClient.GetLatestBlock({}, (err: unknown, res: any) => {
            if (err) return reject(err as Error);

            const { height } = parseTendermintBlockResponse(res);
            resolve(height);
        });
    });
}

async function getBlockData(
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
                        error,
                        {
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

async function getCosmosValidatorSet(
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
                    error,
                    {
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
            error,
            {
                blockHeight: height,
                event: "validator_set_retrieval_error",
            },
        );
        throw error;
    }
}

async function getVoteExt(mkClient: any, height: number): Promise<VoteExt[]> {
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
        logger.error("Error parsing vote extension response", error, {
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
                            err,
                            {
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
                            parseError,
                            {
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
            logger.error("Error recovering public key", error, {
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

async function storePulsarBlock(blockData: BlockData) {
    const { validators, ...rest } = blockData;

    const validatorListHash = computeValidatorListHash(validators);

    const blockDoc = await storeBlock({
        ...rest,
        validators,
        validatorListHash,
    });

    // Store block into its epoch
    const index = blockData.height % BLOCK_EPOCH_SIZE;
    const epoch = await storeBlockInBlockEpoch(
        blockData.height,
        blockDoc._id,
        index,
    );

    // If epoch is full, trigger block-prover
    const isEpochFull = epoch.blocks.every((b) => b !== null);
    if (isEpochFull) {
        const epochHeight =
            Math.floor(blockData.height / BLOCK_EPOCH_SIZE) * BLOCK_EPOCH_SIZE;
        await blockProverQ.add(
            "block-prover",
            { height: epochHeight },
            {
                jobId: blockProverJobId(epochHeight),
                ...DEFAULT_JOB_OPTIONS,
            },
        );
        logger.info("Epoch full, block-prover job enqueued", {
            epochHeight,
            event: "block_prover_triggered",
        });
    }

    logger.info("Stored Pulsar block", {
        blockHeight: blockData.height,
        validatorsCount: validators.length,
        event: "pulsar_block_stored",
    });
}
