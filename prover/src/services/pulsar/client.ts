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
import { BlockModel, storeBlock, storeBlockInBlockEpoch } from "../../db/index.js";
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
        // From EPOCH_START_HEIGHT on, every block appears in a proven pair as
        // the signed side: its body IS the message the validators signed, and
        // no header can reconstruct nextValidatorSetHash or actionsReducedRoot.
        // Falling back there persists a block no signature can ever match,
        // which wedges its leaf — and the strictly ordered settle chain behind
        // it — forever (live incident: block 1623 fell back and its epoch
        // failed 24977 times while the doctor reported no wedge). A retry loop
        // in sync is visible and recoverable; a poisoned block is neither.
        if (height >= EPOCH_START_HEIGHT) throw err;

        // Below the anchor no signature is ever verified against these fields,
        // so the header fallback is safe: those blocks exist only to be
        // skipped. VoteExtBodyByHeight(H+2) genuinely fails for them because
        // Cosmos SDK staking has no historical info before the chain's first
        // staking snapshot.
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
        // The body commits the app hash block `height` PRODUCED, and CometBFT
        // publishes that hash in the next header — header H carries the state
        // after H-1. So the header that matches the signed body is height + 1;
        // reading header `height` stores the previous block's root. Sync only
        // reaches H once the tip is at H + VOTE_EXT_PERSISTENCE_LAG, so H+1
        // always exists here.
        const blockRes = await grpcUnary<GetBlockByHeightResponse>((cb) =>
            tmClient.getBlockByHeight({ height: (height + 1).toString() }, cb),
        );
        stateRoot = appHashToStateRootField(blockRes.block?.header?.app_hash);
        validatorListHash = undefined; // will be computed from validators in storePulsarBlock
        actionsReducedRoot = "0";
    }

    // A "0" actions root is only legitimate before the chain's first reduce:
    // the root never reverts to "0" once set. Whichever path produced it —
    // the early-chain fallback above OR a successful VoteExtBodyByHeight
    // whose root field came back empty — a "0" after the previous block
    // carries a non-zero root is a corrupt read. Storing it poisons the
    // block with a signed message the validators never produced and the
    // epoch fails quorum forever (live incident: blocks 70445/71548/71677/
    // 71931/71947). Bail out and let sync retry the height.
    if (actionsReducedRoot === "0") {
        const previous = await BlockModel.findOne({ height: height - 1 });
        if (previous && previous.actionsReducedRoot !== "0") {
            throw new Error(
                `Refusing actionsReducedRoot="0" for block ${height}: the previous ` +
                    `block's root is non-zero and the root never reverts — corrupt read, retrying`,
            );
        }
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

    // Same encoding as the hashes above: raw big-endian field bytes, decoded
    // with the shared reader. The validators sign this exact field element,
    // so any other reading of the same bytes proves a different block.
    const actionsReducedRoot = protoBufferToDecStr(body.actions_reduced_root);

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
