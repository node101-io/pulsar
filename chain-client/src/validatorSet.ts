import { createHash } from "node:crypto";

import { grpcUnary, protoBytesToBuffer } from "./transport.js";
import { parseMinaPubkeyFromBytes } from "./parser.js";
import type {
    GetLatestBlockResponse,
    GetValidatorSetByHeightResponse,
    KeyregistryService,
    QueryGetValidatorMinaPubKeyResponse,
    TendermintService,
    ValidatorSetMember,
} from "./grpcTypes.js";

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
export function extractEd25519PubKey(v: ValidatorSetMember): Buffer {
    const anyValue = protoBytesToBuffer(v.pub_key?.value);
    return anyValue.length >= 34 ? anyValue.subarray(2, 34) : Buffer.alloc(0);
}

export async function getMinaPubKeyFromEd25519(
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

/**
 * Fetch the validator set at `height` (or the chain tip with "latest") with
 * each validator's Mina key resolved via the keyregistry. A validator whose
 * Mina key cannot be resolved is skipped, not fatal — the chain's committed
 * validator-set hash excludes it too.
 *
 * TODO(chain GetValidatorSetWithMinaKeys): the chain team is adding a single
 * query that returns [{ mina_pub_key, voting_power }] in fold order. Once it
 * lands on the pinned commit:
 *   1. bump the ref in scripts/vendor-protos.sh, run
 *      `pnpm run proto:vendor && pnpm run proto:gen`
 *   2. replace this whole function body with that one RPC — the per-validator
 *      GetValidatorMinaPubKey fan-out, extractEd25519PubKey and the consAddr
 *      sha256 all disappear (krClient param goes away)
 *   3. delete sortValidatorsByPower + ValidatorEntry.consAddr (the chain
 *      already returns fold order) and drop the sort at the two call sites:
 *      prover getBlockData, bridge resolveValidatorSetForRoot
 */
export async function getValidatorSet(
    tmClient: Pick<TendermintService, "GetValidatorSetByHeight"> &
        Partial<Pick<TendermintService, "GetLatestValidatorSet">>,
    krClient: KeyregistryService,
    height: number | "latest",
    logger: ChainLogger = silentLogger,
): Promise<ValidatorEntry[]> {
    if (height === "latest" && !tmClient.GetLatestValidatorSet) {
        throw new Error(
            "getValidatorSet('latest') requires a client with GetLatestValidatorSet",
        );
    }
    let res: GetValidatorSetByHeightResponse;
    try {
        res = await grpcUnary<GetValidatorSetByHeightResponse>((cb) =>
            height === "latest"
                ? tmClient.GetLatestValidatorSet!({}, cb)
                : tmClient.GetValidatorSetByHeight(
                      { height: height.toString() },
                      cb,
                  ),
        );
    } catch (error) {
        logger.error(`Error retrieving validator set for height ${height}`, {
            error,
            blockHeight: height,
            event: "validator_set_retrieval_error",
        });
        throw error;
    }

    // The keyregistry exposes only a point lookup (no batch RPC), so each
    // validator needs its own GetValidatorMinaPubKey call — but they are
    // independent, so fan them out concurrently instead of awaiting serially
    // (N sequential round-trips → ~1 round-trip wall-clock). A validator whose
    // Mina key cannot be resolved is skipped, not fatal — the chain's committed
    // validator-set hash excludes it too.
    const entries = await Promise.all(
        (res.validators ?? []).map(async (v): Promise<ValidatorEntry | null> => {
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
                return {
                    minaPublicKey: minaKey,
                    power: String(v.voting_power ?? "0"),
                    consAddr,
                };
            } catch (error) {
                logger.error("Error retrieving Mina public key for validator", {
                    error,
                    blockHeight: height,
                    event: "validator_key_retrieval_error",
                });
                return null;
            }
        }),
    );

    return entries.filter((e): e is ValidatorEntry => e !== null);
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
