import { createHash } from "node:crypto";

import { Metadata } from "@grpc/grpc-js";

import { grpcUnary, protoBytesToBuffer } from "./transport.js";
import { parseMinaPubkeyFromBytes } from "./parser.js";
import type {
    GetLatestBlockResponse,
    GetLatestValidatorSetResponse,
    GetValidatorSetByHeightResponse,
    KeyregistryClient,
    QueryGetValidatorSetWithMinaKeysResponse,
    TendermintClient,
} from "./transport.js";
import type { Validator } from "./generated/cosmos/base/tendermint/v1beta1/query.js";

// Minimal logging surface so consumers can plug their own structured logger
// (winston etc.) without this package depending on one.
export interface ChainLogger {
    warn(message: string, meta?: object): void;
    error(message: string, meta?: object): void;
}

const silentLogger: ChainLogger = { warn() {}, error() {} };

export interface ValidatorEntry {
    minaPublicKey: string; // Mina PublicKey base58 (join key for vote extensions)
    power: string; // consensus/voting power, decimal string
    consAddr: Buffer; // 20-byte consensus address (sha256(pubkey)[:20]) for tie-break
}

// Mirror the chain's sortValidatorsByPower: power ASCENDING, ties broken by
// consensus-address bytes ascending (Go bytes.Compare).
export function sortValidatorsByPower(
    validators: ValidatorEntry[],
): ValidatorEntry[] {
    return [...validators].sort((a, b) => {
        const pA = BigInt(a.power);
        const pB = BigInt(b.power);
        if (pA < pB) return -1;
        if (pA > pB) return 1;
        return Buffer.compare(a.consAddr, b.consAddr);
    });
}

// The consensus pub_key arrives as a protobuf Any: 2 bytes of field header
// followed by the 32-byte ed25519 key.
export function extractEd25519PubKey(v: Validator): Buffer {
    const anyValue = protoBytesToBuffer(v.pub_key?.value);
    return anyValue.length >= 34 ? anyValue.subarray(2, 34) : Buffer.alloc(0);
}

/**
 * Fetch the validator set at `height` (or the chain tip with "latest") with
 * each validator's Mina key attached, in exactly two requests:
 *
 *   1. the set (ed25519 keys + powers) from the tendermint service
 *   2. one batch GetValidatorSetWithMinaKeys keyregistry call, pinned to the
 *      SAME state snapshot via the `x-cosmos-block-height` metadata header —
 *      a key rotation can never produce a mixed set/keys pairing
 *
 * A validator without a registered Mina key rejects the whole batch call
 * (NotFound) — deliberately matching the chain's own root fold, which also
 * hard-fails there (ErrValidatorMinaKeyNotFound): such a set never produced
 * a committed root in the first place.
 */
export async function getValidatorSet(
    tmClient: Pick<TendermintClient, "getValidatorSetByHeight"> &
        Partial<Pick<TendermintClient, "getLatestValidatorSet">>,
    krClient: Pick<KeyregistryClient, "getValidatorSetWithMinaKeys">,
    height: number | "latest",
    logger: ChainLogger = silentLogger,
): Promise<ValidatorEntry[]> {
    if (height === "latest" && !tmClient.getLatestValidatorSet) {
        throw new Error(
            "getValidatorSet('latest') requires a client with getLatestValidatorSet",
        );
    }
    try {
        const res = await grpcUnary<
            GetValidatorSetByHeightResponse | GetLatestValidatorSetResponse
        >((cb) =>
            height === "latest"
                ? tmClient.getLatestValidatorSet!({}, cb)
                : tmClient.getValidatorSetByHeight(
                      { height: height.toString() },
                      cb,
                  ),
        );

        const members = (res.validators ?? [])
            .map((v) => ({
                pubKeyBytes: extractEd25519PubKey(v),
                power: String(v.voting_power ?? "0"),
            }))
            .filter((m) => m.pubKeyBytes.length > 0);

        // Pin the keyregistry read to the same snapshot the set came from —
        // for "latest" both calls run unpinned against the tip.
        const metadata = new Metadata();
        if (height !== "latest") {
            metadata.add("x-cosmos-block-height", height.toString());
        }

        const batch =
            await grpcUnary<QueryGetValidatorSetWithMinaKeysResponse>((cb) =>
                krClient.getValidatorSetWithMinaKeys(
                    {
                        validators: members.map((m) => ({
                            validator_cosmos_pub_key: m.pubKeyBytes,
                            consensus_power: m.power,
                        })),
                    },
                    metadata,
                    cb,
                ),
            );

        return (batch.registered_validators ?? []).map((r) => {
            const cosmosKey = protoBytesToBuffer(r.validator_cosmos_pub_key);
            return {
                minaPublicKey: parseMinaPubkeyFromBytes(
                    protoBytesToBuffer(r.validator_mina_pub_key),
                ),
                power: String(r.consensus_power ?? "0"),
                // Consensus address = sha256(ed25519 pubkey)[:20], matching
                // the chain's validator.GetConsAddr() sort tie-break.
                consAddr: createHash("sha256")
                    .update(cosmosKey)
                    .digest()
                    .subarray(0, 20),
            };
        });
    } catch (error) {
        logger.error(`Error retrieving validator set for height ${height}`, {
            error,
            blockHeight: height,
            event: "validator_set_retrieval_error",
        });
        throw error;
    }
}

export async function getLatestHeight(
    tmClient: Pick<TendermintClient, "getLatestBlock">,
): Promise<number> {
    const res = await grpcUnary<GetLatestBlockResponse>((cb) =>
        tmClient.getLatestBlock({}, cb),
    );

    const height = res.block?.header?.height;
    return height ? Number(height) : NaN;
}
