import { Metadata } from "@grpc/grpc-js";

import {
    type BridgeQueryClient,
    type QueryActionsReducedRootResponse,
    type QueryLatestValidActionHashesResponse,
    grpcUnary,
} from "./transport.js";

export { HISTORICAL_HEIGHT_HEADER, historicalHeightMetadata };
export { fetchLatestValidActionHashes, fetchActionsReducedRoot };

// Standard Cosmos historical state query: the request runs against the state
// version committed at that height. Height 0 means LATEST, not genesis — so
// an unpinned read simply sends no metadata instead of pinning 0.
const HISTORICAL_HEIGHT_HEADER = "x-cosmos-block-height";

function historicalHeightMetadata(atCosmosHeight?: number): Metadata {
    const metadata = new Metadata();
    if (atCosmosHeight !== undefined)
        metadata.add(HISTORICAL_HEIGHT_HEADER, String(atCosmosHeight));
    return metadata;
}

/**
 * The chain's latest valid-action batch (x/bridge Query/LatestValidActionHashes)
 * as served — decimal-string field elements and quoted int64s straight off the
 * generated codec. Validation (digits, field range, canonicalisation) is the
 * consumer's job: the bridge owns the error taxonomy those checks feed.
 */
async function fetchLatestValidActionHashes(
    client: Pick<BridgeQueryClient, "latestValidActionHashes">,
    atCosmosHeight?: number,
): Promise<QueryLatestValidActionHashesResponse> {
    return grpcUnary<QueryLatestValidActionHashesResponse>((cb) =>
        client.latestValidActionHashes(
            {},
            historicalHeightMetadata(atCosmosHeight),
            cb,
        ),
    );
}

/** The cumulative approval root (x/bridge Query/ActionsReducedRoot), as served. */
async function fetchActionsReducedRoot(
    client: Pick<BridgeQueryClient, "actionsReducedRoot">,
    atCosmosHeight?: number,
): Promise<QueryActionsReducedRootResponse> {
    return grpcUnary<QueryActionsReducedRootResponse>((cb) =>
        client.actionsReducedRoot(
            {},
            historicalHeightMetadata(atCosmosHeight),
            cb,
        ),
    );
}
