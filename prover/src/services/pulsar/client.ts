import * as grpc from "@grpc/grpc-js";
import { Field, Poseidon, PublicKey } from "o1js";
import { computeValidatorListHash as sharedComputeValidatorListHash } from "pulsar-contracts";
import {
    decodeMinaSignature,
    getValidatorSet,
    grpcUnary,
    isServiceError,
    parseMinaPubkeyFromBytes,
    protoBufferToDecStr,
    protoBytesToBuffer,
    sortValidatorsByPower,
    type AbciQueryClient,
    type GetBlockByHeightResponse,
    type KeyregistryClient,
    type ProtoBytes,
    type QueryVoteExtBodyByHeightResponse,
    type QueryVoteExtensionsResponse,
    type TendermintClient,
    type VotePersistenceClient,
} from "pulsar-chain-client";

import logger from "../../common/logger.js";
import { storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
import { BlockData, ValidatorInfo, VoteExt } from "../../common/types.js";
import {
    BLOCK_EPOCH_SIZE,
    EPOCH_START_HEIGHT,
    VOTE_EXT_PERSISTENCE_LAG,
} from "../../config/constants.js";

export async function getBlockData(
    tmClient: Pick<
        TendermintClient,
        "getBlockByHeight" | "getValidatorSetByHeight"
    >,
    vpClient: VotePersistenceClient,
    krClient: Pick<KeyregistryClient, "getValidatorSetWithMinaKeys">,
    abciClient: AbciQueryClient,
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
            tmClient.getBlockByHeight({ height: height.toString() }, cb),
        );
        stateRoot = appHashToStateRootField(blockRes.block?.header?.app_hash);
        validatorListHash = undefined; // will be computed from validators in storePulsarBlock
        actionsReducedRoot = "0";
    }

    const voteExt = await getVoteExtsByHeight(vpClient, height);

    // Full validator set, sorted in the chain's fold order (power ASC, then
    // consensus-address ASC) so the circuit's recomputed validator-set root
    // matches the committed nextValidatorSetHash.
    const validatorEntries = await getValidatorSet(
        tmClient,
        krClient,
        height,
        logger,
    );
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
    abciClient: AbciQueryClient,
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
            abciClient.voteExtBodyByHeight(
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

export async function getVoteExtsByHeight(
    vpClient: VotePersistenceClient,
    height: number,
): Promise<VoteExt[]> {
    const queryHeight = height + VOTE_EXT_PERSISTENCE_LAG;
    const metadata = new grpc.Metadata();
    metadata.add("x-cosmos-block-height", queryHeight.toString());

    let res: QueryVoteExtensionsResponse;
    try {
        res = await grpcUnary<QueryVoteExtensionsResponse>((cb) =>
            vpClient.voteExtensions({}, metadata, cb),
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

// Thin adapter over the shared convention in pulsar-contracts — the leaf
// format lives next to the circuits (utils/validatorList.ts), never inline it.
export function computeValidatorListHash(validators: ValidatorInfo[]): string {
    return sharedComputeValidatorListHash(
        validators.map(({ addr, power }) => ({
            publicKey: PublicKey.fromBase58(addr),
            power: Field(power),
        })),
    ).toString();
}
