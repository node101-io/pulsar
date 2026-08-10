import { Field, PublicKey } from "o1js";
import {
    getValidatorSet,
    grpcCredentials,
    sortValidatorsByPower,
    KeyregistryClient,
    TendermintClient,
} from "pulsar-chain-client";
import { computeValidatorListHash } from "pulsar-contracts";

import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

// The circuits verify the validator MerkleList by rebuilding every leaf as
// hashValidatorLeaf(publicKey, power) in the chain's fold order, so the bridge
// must source the FULL ordered validator set (with powers) from the chain —
// the vote-extension archive alone (per-validator signatures, no order, no
// power) can never reproduce the root.

export interface OrderedValidator {
    minaPublicKey: string;
    power: string;
}

let _clients: { tm: TendermintClient; kr: KeyregistryClient } | null = null;

async function getClients() {
    if (_clients) return _clients;

    const endpoint = env.PULSAR_GRPC_ENDPOINT;
    if (!endpoint) throw new Error("PULSAR_GRPC_ENDPOINT is not set");

    const creds = grpcCredentials(endpoint);
    _clients = {
        tm: new TendermintClient(endpoint, creds),
        kr: new KeyregistryClient(endpoint, creds),
    };
    return _clients;
}

// Leaf convention lives in pulsar-contracts (utils/validatorList.ts), next to
// the circuits that verify it — never inline the hash here.
// Exported for tests: exercises the cross-package path for real.
export function validatorSetHash(validators: OrderedValidator[]): string {
    return computeValidatorListHash(
        validators.map(({ minaPublicKey, power }) => ({
            publicKey: PublicKey.fromBase58(minaPublicKey),
            power: Field(power),
        })),
    ).toString();
}

const setByRoot = new Map<string, OrderedValidator[]>();

/**
 * Fetch the ordered validator set (with powers) whose leaf fold reproduces the
 * contract's on-chain merkleListRoot. `aroundHeight` is the contract's settled
 * blockHeight; neighbors are probed to tolerate the chain's snapshot
 * convention, but the root hash is the source of truth — a set is only
 * returned if it verifiably matches, so a mismatch fails fast here instead of
 * as an opaque assert inside proof generation.
 */
export async function resolveValidatorSetForRoot(
    merkleListRoot: string,
    aroundHeight: number,
): Promise<OrderedValidator[]> {
    const cached = setByRoot.get(merkleListRoot);
    if (cached) return cached;

    const tried: string[] = [];

    // Lightnet/dev escape hatch: with no Pulsar chain to query, the ordered
    // set can be supplied directly (parsed and shape-checked by the env
    // schema). It passes the exact same hash gate as every gRPC candidate,
    // so a wrong override fails fast here and can never reach proving.
    const override = env.VALIDATOR_SET_OVERRIDE;
    if (override) {
        const hash = validatorSetHash(override);
        if (hash === merkleListRoot) {
            setByRoot.set(merkleListRoot, override);
            return override;
        }
        tried.push(`override (hash ${hash})`);
    }

    if (!env.PULSAR_GRPC_ENDPOINT) {
        throw new Error(
            `No validator set reproduces on-chain merkleListRoot ` +
                `${merkleListRoot}; tried: ${tried.join(", ") || "nothing"} ` +
                `(PULSAR_GRPC_ENDPOINT not set)`,
        );
    }

    const { tm, kr } = await getClients();
    // "latest" is the fallback for pruned nodes: the contract's settled height
    // can fall outside the node's retained state window while the validator
    // set itself is unchanged — the tip's set then still folds to the root.
    // Every candidate is hash-gated, so probing more heights is always safe.
    const candidates: Array<number | "latest"> = [
        aroundHeight,
        aroundHeight + 1,
        aroundHeight - 1,
        "latest",
    ];
    for (const height of candidates) {
        if (height !== "latest" && height < 1) continue;
        let ordered: OrderedValidator[];
        try {
            ordered = sortValidatorsByPower(
                await getValidatorSet(tm, kr, height, logger),
            ).map(({ minaPublicKey, power }) => ({ minaPublicKey, power }));
        } catch (error) {
            tried.push(`${height} (fetch failed)`);
            logger.warn("Validator set fetch failed", {
                height,
                error: error instanceof Error ? error.message : String(error),
                event: "validator_set_fetch_failed",
            });
            continue;
        }

        const hash = validatorSetHash(ordered);
        if (hash === merkleListRoot) {
            setByRoot.set(merkleListRoot, ordered);
            return ordered;
        }
        tried.push(`${height} (hash ${hash})`);
    }

    throw new Error(
        `No validator set reproduces on-chain merkleListRoot ${merkleListRoot}; ` +
            `tried heights: ${tried.join(", ")}`,
    );
}
