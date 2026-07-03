import { createHash } from "node:crypto";

import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { Field, Poseidon, PublicKey } from "o1js";
import { List } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
import { BlockData, ValidatorInfo, VoteExt } from "../../common/types.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
} from "../../config/constants.js";
import { decodeMinaSignature, parseMinaPubkeyFromBytes } from "./parser.js";
import {
    AbciQueryService,
    GetBlockByHeightResponse,
    GetLatestBlockResponse,
    GetValidatorSetByHeightResponse,
    GrpcCallback,
    KeyregistryService,
    ProtoBytes,
    QueryGetValidatorMinaPubKeyResponse,
    QueryVoteExtBodyByHeightResponse,
    QueryVoteExtensionsResponse,
    TendermintService,
    ValidatorSetMember,
    VotePersistenceService,
} from "./grpcTypes.js";

export async function createClient<T>(
    serviceName: string,
    rpcAddress: string,
    credentials: grpc.ChannelCredentials,
): Promise<T> {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const serviceDescriptor = await reflectionClient.getDescriptorBySymbol(
        serviceName,
    );

    const packageObject = serviceDescriptor.getPackageObject({
        keepCase: true,
        enums: String,
        longs: String,
    });

    // The reflection client builds service constructors dynamically, so the
    // traversal below is inherently untyped; the caller pins the service
    // surface via T (see grpcTypes.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let serviceClass: any = packageObject;

    const servicePath = serviceName.split(".");
    const finalServiceName = servicePath.pop();

    for (const part of servicePath) serviceClass = serviceClass[part];
    serviceClass = serviceClass[finalServiceName!];

    return new serviceClass(rpcAddress, credentials) as T;
}

// Promisify a single callback-style gRPC call:
//   const res = await grpcUnary((cb) => client.Method(req, cb));
export function grpcUnary<TRes>(
    call: (cb: GrpcCallback<TRes>) => void,
): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
        call((err, res) => (err ? reject(err) : resolve(res)));
    });
}

export function isServiceError(err: unknown): err is grpc.ServiceError {
    return err instanceof Error && "code" in err;
}

export async function getLatestHeight(
    tmClient: Pick<TendermintService, "GetLatestBlock">,
): Promise<number> {
    const res = await grpcUnary<GetLatestBlockResponse>((cb) =>
        tmClient.GetLatestBlock({}, cb),
    );

    const height = res.block?.header?.height;
    return height ? Number(height) : NaN;
}

export async function getBlockData(
    tmClient: Pick<
        TendermintService,
        "GetBlockByHeight" | "GetValidatorSetByHeight"
    >,
    vpClient: VotePersistenceService,
    krClient: KeyregistryService,
    abciClient: AbciQueryService,
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
                error: err instanceof Error ? err.message : String(err),
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
        const blockRes = await grpcUnary<GetBlockByHeightResponse>((cb) =>
            tmClient.GetBlockByHeight({ height: height.toString() }, cb),
        );
        stateRoot = appHashToStateRootField(blockRes.block?.header?.app_hash);
        validatorListHash = undefined; // will be computed from validators in storePulsarBlock
        actionsReducedRoot = "0";
    }

    const voteExt = await getVoteExtsByHeight(vpClient, height);

    // Full validator set, sorted in the chain's fold order (power ASC, then
    // consensus-address ASC) so the circuit's recomputed validator-set root
    // matches the committed nextValidatorSetHash.
    const validatorEntries = await getValidatorSet(tmClient, krClient, height);
    const sorted = sortValidatorsByPower(validatorEntries);

    return {
        height,
        stateRoot,
        validators: sorted.map((v) => ({
            addr: v.minaPublicKey,
            power: v.power,
        })),
        validatorListHash,
        actionsReducedRoot,
        voteExt,
    };
}

async function getVoteExtBody(
    abciClient: AbciQueryService,
    height: number,
): Promise<{
    stateRoot: string;
    nextValidatorSetHash: string;
    actionsReducedRoot: string;
}> {
    // VoteExtBody for block H is accessible via VoteExtBodyByHeight(H+2).
    const bodyHeight = height + 2;

    let res: QueryVoteExtBodyByHeightResponse;
    try {
        res = await grpcUnary<QueryVoteExtBodyByHeightResponse>((cb) =>
            abciClient.VoteExtBodyByHeight(
                { vote_extension_height: String(bodyHeight) },
                cb,
            ),
        );
    } catch (err) {
        logger.error("VoteExtBodyByHeight gRPC call failed", {
            message: isServiceError(err) ? err.message : String(err),
            code: isServiceError(err) ? err.code : undefined,
            blockHeight: height,
            bodyHeight,
            event: "vote_ext_body_error",
        });
        throw err;
    }

    const body = res.vote_ext_body;
    if (!body) {
        throw new Error(
            `empty VoteExtBodyByHeight response for height ${bodyHeight}`,
        );
    }

    const stateRoot = appHashToStateRootField(body.current_state_root);
    const nextValidatorSetHash = protoBufferToDecStr(
        body.next_validator_set_hash,
    );

    // actionsReducedRoot is a string in the proto — convert to BigInt via UTF-8 bytes
    const actionsRootBytes = Buffer.from(
        body.actions_reduced_root ?? "",
        "utf-8",
    );
    const actionsReducedRoot =
        actionsRootBytes.length > 0
            ? BigInt("0x" + actionsRootBytes.toString("hex")).toString()
            : "0";

    logger.debug("VoteExtBody fetched", {
        blockHeight: height,
        stateRoot,
        nextValidatorSetHash,
        actionsReducedRoot,
        event: "vote_ext_body_fetched",
    });

    return { stateRoot, nextValidatorSetHash, actionsReducedRoot };
}

// Normalize a proto `bytes` field: gRPC delivers Buffers, JSON-transcoded
// responses deliver base64 strings.
function protoBytesToBuffer(val: ProtoBytes | null | undefined): Buffer {
    if (val == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === "string") return Buffer.from(val, "base64");
    return Buffer.from(val);
}

function protoBufferToDecStr(val: ProtoBytes | null | undefined): string {
    const buf = protoBytesToBuffer(val);
    if (buf.length === 0) return "0";
    return BigInt("0x" + buf.toString("hex")).toString();
}

// The AppHash is a raw 32-byte (256-bit) hash that overflows the Mina field, so
// the chain commits stateRoot = Poseidon([ BE(appHash[0:16]), BE(appHash[16:32]) ]).
// The prover must reproduce the exact same field for signatures to verify.
function appHashToStateRootField(val: ProtoBytes | null | undefined): string {
    const buf = protoBytesToBuffer(val);
    if (buf.length === 0) return "0";
    if (buf.length !== 32) {
        throw new Error(`AppHash must be 32 bytes, got ${buf.length}`);
    }
    const hi = BigInt("0x" + buf.subarray(0, 16).toString("hex"));
    const lo = BigInt("0x" + buf.subarray(16, 32).toString("hex"));
    return Poseidon.hash([Field(hi), Field(lo)]).toString();
}

interface ValidatorEntry {
    minaPublicKey: string; // Mina PublicKey base58 (join key for vote extensions)
    power: string; // consensus/voting power, decimal string
    consAddr: Buffer; // 20-byte consensus address (sha256(pubkey)[:20]) for tie-break
}

// Mirror the chain's sortValidatorsByPower: power ASCENDING, ties broken by
// consensus-address bytes ascending (Go bytes.Compare).
function sortValidatorsByPower(validators: ValidatorEntry[]): ValidatorEntry[] {
    return [...validators].sort((a, b) => {
        const pA = BigInt(a.power);
        const pB = BigInt(b.power);
        if (pA < pB) return -1;
        if (pA > pB) return 1;
        return Buffer.compare(a.consAddr, b.consAddr);
    });
}

export async function getVoteExtsByHeight(
    vpClient: VotePersistenceService,
    height: number,
): Promise<VoteExt[]> {
    const queryHeight = height + 3;
    const metadata = new grpc.Metadata();
    metadata.add("x-cosmos-block-height", queryHeight.toString());

    let res: QueryVoteExtensionsResponse;
    try {
        res = await grpcUnary<QueryVoteExtensionsResponse>((cb) =>
            vpClient.VoteExtensions({}, metadata, cb),
        );
    } catch (err) {
        logger.error("VoteExtensions gRPC call failed", {
            message: isServiceError(err) ? err.message : String(err),
            code: isServiceError(err) ? err.code : undefined,
            details: isServiceError(err) ? err.details : undefined,
            blockHeight: height,
            queryHeight,
            event: "vote_extensions_error",
        });
        throw err;
    }

    const persistedRaw = res.persisted_vote_extensions_block_height;
    const persisted = Number(persistedRaw);

    // Expected: persistedH = height (the signed state height, not persistence height)
    if (persisted !== height) {
        logger.warn("VoteExtensions not available for block, storing empty", {
            blockHeight: height,
            queryHeight,
            persistedRaw,
            event: "vote_extensions_not_available",
        });
        return [];
    }

    return (res.vote_extensions ?? []).map((v) => ({
        validatorAddr: parseMinaPubkeyFromBytes(
            protoBytesToBuffer(v.mina_public_key),
        ),
        signature: decodeMinaSignature(protoBytesToBuffer(v.vote_extension)),
    }));
}

export async function storePulsarBlock(blockData: BlockData) {
    // validatorListHash comes from VoteExtBodyByHeight (nextValidatorSetHash).
    // Fall back to computing it locally only if not provided.
    const validatorListHash =
        blockData.validatorListHash ??
        computeValidatorListHash(blockData.validators);

    const block = await storeBlock({ ...blockData, validatorListHash });

    if (blockData.height >= EPOCH_START_HEIGHT) {
        const index =
            (blockData.height - EPOCH_START_HEIGHT) % BLOCK_EPOCH_SIZE;
        await storeBlockInBlockEpoch(blockData.height, block._id, index);
    }

    logger.info("Stored Pulsar block", {
        blockHeight: blockData.height,
        validatorsCount: blockData.validators.length,
        event: "pulsar_block_stored",
    });
}

async function getValidatorSet(
    tmClient: Pick<TendermintService, "GetValidatorSetByHeight">,
    krClient: KeyregistryService,
    height: number,
): Promise<ValidatorEntry[]> {
    try {
        const res = await grpcUnary<GetValidatorSetByHeightResponse>((cb) =>
            tmClient.GetValidatorSetByHeight(
                { height: height.toString() },
                cb,
            ),
        );

        const validators: ValidatorEntry[] = [];
        for (const v of res.validators ?? []) {
            const pubKeyBytes = extractEd25519PubKey(v);
            try {
                const minaKey = await getMinaPubKeyFromEd25519(
                    krClient,
                    pubKeyBytes,
                );
                // Consensus address = sha256(ed25519 pubkey)[:20], matching the
                // chain's validator.GetConsAddr() used as the sort tie-break.
                const consAddr = createHash("sha256")
                    .update(pubKeyBytes)
                    .digest()
                    .subarray(0, 20);
                validators.push({
                    minaPublicKey: minaKey,
                    power: String(v.voting_power ?? "0"),
                    consAddr,
                });
            } catch (error) {
                logger.error("Error retrieving Mina public key for validator", {
                    error,
                    blockHeight: height,
                    event: "validator_key_retrieval_error",
                });
            }
        }
        return validators;
    } catch (error) {
        logger.error(`Error retrieving validator set for height ${height}`, {
            error,
            blockHeight: height,
            event: "validator_set_retrieval_error",
        });
        throw error;
    }
}

// The consensus pub_key arrives as a protobuf Any: 2 bytes of field header
// followed by the 32-byte ed25519 key.
function extractEd25519PubKey(v: ValidatorSetMember): Buffer {
    const anyValue = protoBytesToBuffer(v.pub_key?.value);
    return anyValue.length >= 34 ? anyValue.subarray(2, 34) : Buffer.alloc(0);
}

async function getMinaPubKeyFromEd25519(
    krClient: KeyregistryService,
    pubKeyBytes: Buffer,
): Promise<string> {
    const res = await grpcUnary<QueryGetValidatorMinaPubKeyResponse>((cb) =>
        krClient.GetValidatorMinaPubKey(
            { validator_cosmos_pub_key: pubKeyBytes },
            cb,
        ),
    );

    return parseMinaPubkeyFromBytes(
        protoBytesToBuffer(res.validator_mina_pub_key),
    );
}

export function computeValidatorListHash(validators: ValidatorInfo[]): string {
    const validatorsList = List.empty();

    for (const { addr, power } of validators) {
        validatorsList.push(
            Poseidon.hashWithPrefix("pulsar-validator", [
                ...PublicKey.fromBase58(addr).toFields(),
                Field(power),
            ]),
        );
    }

    return validatorsList.hash.toString();
}
